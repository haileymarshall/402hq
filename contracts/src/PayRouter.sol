// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {AgentMarket} from "./AgentMarket.sol";

/// @dev Uniswap v4 pool key. Currencies are plain addresses; address(0) is native ETH.
struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

struct SwapParams {
    bool zeroForOne;
    /// @dev negative = exact input, positive = exact output
    int256 amountSpecified;
    uint160 sqrtPriceLimitX96;
}

interface IPoolManager {
    function unlock(bytes calldata data) external returns (bytes memory);

    /// @return swapDelta amount0 in the upper 128 bits, amount1 in the lower 128 bits; negative = owed to the pool
    function swap(PoolKey memory key, SwapParams memory params, bytes calldata hookData)
        external
        returns (int256 swapDelta);

    function settle() external payable returns (uint256 paid);

    function take(address currency, address to, uint256 amount) external;
}

/// @dev the Uniswap v3 pool interface, used for the USDG/$WIF pool
interface IUniswapV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);

    /// @param amountSpecified positive = exact input, negative = exact output
    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96, bytes calldata data)
        external
        returns (int256 amount0, int256 amount1);
}

/// @title PayRouter
/// @notice Pay for a job on the AgentMarket with ETH or USDG. The router buys exactly the job's price in $WIF (ETH
///         through the main ETH/$WIF Uniswap v4 pool, USDG through the USDG/$WIF v3 pool) and settles the job in the
///         same transaction, so buyers never need to hold $WIF and every job is a market buy of $WIF. The router never
///         keeps funds: unspent ETH goes straight back, and USDG is pulled for the exact amount the swap needs.
contract PayRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev one above TickMath.MIN_SQRT_PRICE: no price limit when selling currency0
    uint160 private constant NO_LIMIT = 4295128739 + 1;
    /// @dev Uniswap v3 price limits: no limit in either direction
    uint160 private constant V3_MIN = 4295128739 + 1;
    uint160 private constant V3_MAX = 1461446703485210103287273052203988822378723970342 - 1;

    AgentMarket public immutable market;
    IERC20 public immutable wif;
    IPoolManager public immutable poolManager;
    PoolKey public poolKey;
    /// @notice the USDG/$WIF v3 pool; address(0) when paying in USDG is off
    IUniswapV3Pool public immutable usdgPool;
    IERC20 public immutable usdg;
    bool private immutable wifIsToken0;
    /// @dev who pays for the USDG swap in flight; only set inside payWithUsdg
    address private usdgPayer;

    event PaidWithEth(
        bytes32 indexed jobId, uint256 indexed agentId, address indexed buyer, uint256 ethSpent, uint256 wifBought
    );
    event PaidWithUsdg(
        bytes32 indexed jobId, uint256 indexed agentId, address indexed buyer, uint256 usdgSpent, uint256 wifBought
    );

    error OnlyPoolManager();
    error BadPool();
    error PriceAboveMax();
    error NotEnoughEth(uint256 needed);
    error SwapShort();
    error EthRefundFailed();
    error OnlyUsdgPool();
    error UsdgOff();
    error NotEnoughUsdg(uint256 needed);
    /// @dev carries a quote out of a simulated swap that is always rolled back
    error Quote(uint256 ethIn);

    constructor(AgentMarket market_, IPoolManager poolManager_, PoolKey memory poolKey_, IUniswapV3Pool usdgPool_) {
        market = market_;
        wif = IERC20(address(market_.wif()));
        poolManager = poolManager_;
        if (poolKey_.currency0 != address(0) || poolKey_.currency1 != address(wif)) revert BadPool();
        poolKey = poolKey_;

        usdgPool = usdgPool_;
        if (address(usdgPool_) != address(0)) {
            address t0 = usdgPool_.token0();
            address t1 = usdgPool_.token1();
            if (t0 != address(wif) && t1 != address(wif)) revert BadPool();
            wifIsToken0 = t0 == address(wif);
            usdg = IERC20(wifIsToken0 ? t1 : t0);
        }
    }

    /// @notice Pay for one job in ETH. Send the quoted amount plus a small buffer; whatever isn't needed is returned.
    /// @param maxPrice the most $WIF the job may cost (guards against a price change between quote and payment)
    function payWithEth(uint256 agentId, bytes32 jobId, uint256 maxPrice)
        external
        payable
        nonReentrant
        returns (uint256 ethSpent)
    {
        (uint256 price,,,,) = market.sellerInfo(agentId);
        if (price > maxPrice) revert PriceAboveMax();

        ethSpent = abi.decode(poolManager.unlock(abi.encode(price, msg.value, false)), (uint256));

        wif.forceApprove(address(market), price);
        market.payFor(agentId, jobId, maxPrice, msg.sender);
        emit PaidWithEth(jobId, agentId, msg.sender, ethSpent, price);

        if (msg.value > ethSpent) {
            (bool ok,) = msg.sender.call{value: msg.value - ethSpent}("");
            if (!ok) revert EthRefundFailed();
        }
    }

    /// @notice How much ETH buys `wifAmount` right now. Call it with eth_call; the swap inside is rolled back.
    function quoteEth(uint256 wifAmount) public returns (uint256 ethIn) {
        try poolManager.unlock(abi.encode(wifAmount, uint256(0), true)) {
            revert SwapShort();
        } catch (bytes memory reason) {
            if (reason.length != 36 || bytes4(reason) != Quote.selector) {
                assembly {
                    revert(add(reason, 32), mload(reason))
                }
            }
            assembly {
                ethIn := mload(add(reason, 36))
            }
        }
    }

    /// @notice The job's price in $WIF and the ETH that buys it right now. Call it with eth_call.
    function quoteJob(uint256 agentId) external returns (uint256 price, uint256 ethIn) {
        (price,,,,) = market.sellerInfo(agentId);
        ethIn = quoteEth(price);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        (uint256 wifOut, uint256 maxEth, bool quoteOnly) = abi.decode(data, (uint256, uint256, bool));

        int256 delta = poolManager.swap(
            poolKey, SwapParams({zeroForOne: true, amountSpecified: int256(wifOut), sqrtPriceLimitX96: NO_LIMIT}), ""
        );
        int128 ethDelta = int128(delta >> 128);
        int128 wifDelta = int128(delta);
        if (ethDelta > 0 || wifDelta < 0 || uint256(uint128(wifDelta)) < wifOut) revert SwapShort();
        uint256 ethIn = uint256(uint128(-ethDelta));

        if (quoteOnly) revert Quote(ethIn);
        if (ethIn > maxEth) revert NotEnoughEth(ethIn);

        poolManager.settle{value: ethIn}();
        poolManager.take(address(wif), address(this), uint256(uint128(wifDelta)));
        return abi.encode(ethIn);
    }

    // ------------------------------------------------------------------ paying in USDG

    /// @notice Pay for one job in USDG. Approve the router for at least `maxUsdg` first; it pulls only what the swap
    ///         costs.
    /// @param maxPrice the most $WIF the job may cost
    /// @param maxUsdg the most USDG the buyer will spend (guards against the pool price moving)
    function payWithUsdg(uint256 agentId, bytes32 jobId, uint256 maxPrice, uint256 maxUsdg)
        external
        nonReentrant
        returns (uint256 usdgSpent)
    {
        if (address(usdgPool) == address(0)) revert UsdgOff();
        (uint256 price,,,,) = market.sellerInfo(agentId);
        if (price > maxPrice) revert PriceAboveMax();

        usdgPayer = msg.sender;
        uint256 wifOut;
        (wifOut, usdgSpent) = _swapUsdg(price, abi.encode(maxUsdg, false));
        usdgPayer = address(0);
        if (wifOut < price) revert SwapShort();

        wif.forceApprove(address(market), price);
        market.payFor(agentId, jobId, maxPrice, msg.sender);
        emit PaidWithUsdg(jobId, agentId, msg.sender, usdgSpent, price);
        // exact-output swaps can round up by a wei; never keep it
        if (wifOut > price) wif.safeTransfer(msg.sender, wifOut - price);
    }

    /// @notice How much USDG buys `wifAmount` right now. Call it with eth_call; the swap inside is rolled back.
    function quoteUsdg(uint256 wifAmount) public returns (uint256 usdgIn) {
        if (address(usdgPool) == address(0)) revert UsdgOff();
        try this.simulateUsdg(wifAmount) {
            revert SwapShort();
        } catch (bytes memory reason) {
            if (reason.length != 36 || bytes4(reason) != Quote.selector) {
                assembly {
                    revert(add(reason, 32), mload(reason))
                }
            }
            assembly {
                usdgIn := mload(add(reason, 36))
            }
        }
    }

    /// @notice The job's price in $WIF and the USDG that buys it right now. Call it with eth_call.
    function quoteJobUsdg(uint256 agentId) external returns (uint256 price, uint256 usdgIn) {
        (price,,,,) = market.sellerInfo(agentId);
        usdgIn = quoteUsdg(price);
    }

    /// @dev used by quoteUsdg only: runs the swap, and the callback reverts with the price
    function simulateUsdg(uint256 wifAmount) external {
        _swapUsdg(wifAmount, abi.encode(uint256(0), true));
    }

    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        if (msg.sender != address(usdgPool)) revert OnlyUsdgPool();
        (uint256 maxUsdg, bool quoteOnly) = abi.decode(data, (uint256, bool));
        int256 owed = wifIsToken0 ? amount1Delta : amount0Delta;
        if (owed <= 0) revert SwapShort();
        if (quoteOnly) revert Quote(uint256(owed));
        if (usdgPayer == address(0)) revert OnlyUsdgPool();
        if (uint256(owed) > maxUsdg) revert NotEnoughUsdg(uint256(owed));
        usdg.safeTransferFrom(usdgPayer, address(usdgPool), uint256(owed));
    }

    /// @dev buys exactly `wifOut` $WIF with USDG; returns what came out and what went in
    function _swapUsdg(uint256 wifOut, bytes memory data) private returns (uint256 got, uint256 paid) {
        // buying $WIF means selling the other token: zeroForOne when $WIF is token1
        bool zeroForOne = !wifIsToken0;
        (int256 a0, int256 a1) =
            usdgPool.swap(address(this), zeroForOne, -int256(wifOut), zeroForOne ? V3_MIN : V3_MAX, data);
        int256 wifDelta = wifIsToken0 ? a0 : a1;
        int256 usdgDelta = wifIsToken0 ? a1 : a0;
        got = uint256(-wifDelta);
        paid = uint256(usdgDelta);
    }
}
