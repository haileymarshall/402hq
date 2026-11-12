// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentMarket, IERC20Burnable} from "../src/AgentMarket.sol";
import {PayRouter, IPoolManager, PoolKey, IUniswapV3Pool} from "../src/PayRouter.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

/// Pays for a job with ETH through the live ETH/$WIF Uniswap v4 pool on a Robinhood Chain fork:
/// FORK_URL=<rpc> forge test --match-contract RouterFork
contract RouterForkTest is Test {
    IERC20Burnable constant WIF = IERC20Burnable(0x5173b8eA6923c2d40267890D45C46a3480954773);
    IPoolManager constant POOL_MANAGER = IPoolManager(0x8366a39CC670B4001A1121B8F6A443A643e40951);
    address constant HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;
    IUniswapV3Pool constant USDG_POOL = IUniswapV3Pool(0xc3A41A216afE024cf9F38a01C67E80De8916802c);
    IERC20 constant USDG = IERC20(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168);

    AgentMarket market;
    PayRouter router;
    address arbiter = makeAddr("arbiter");
    address seller = makeAddr("seller");
    address buyer = makeAddr("buyer");
    uint256 agentId;
    bool forked;

    function setUp() public {
        string memory url = vm.envOr("FORK_URL", string(""));
        if (bytes(url).length == 0) return;
        vm.createSelectFork(url);
        forked = true;

        market = new AgentMarket(WIF, 100 ether, 1 hours, 2 hours, arbiter);
        router = new PayRouter(
            market,
            POOL_MANAGER,
            PoolKey({currency0: address(0), currency1: address(WIF), fee: 0, tickSpacing: 200, hooks: HOOK}),
            USDG_POOL
        );

        deal(address(WIF), seller, 5_000 ether);
        vm.startPrank(seller);
        WIF.approve(address(market), type(uint256).max);
        agentId = market.registerAgent("contract-scan", "e", 400 ether, 0, seller, 5_000 ether);
        vm.stopPrank();
        vm.deal(buyer, 1 ether);
    }

    function test_quoteAndPayWithEth() public {
        if (!forked) return;
        (uint256 price, uint256 ethIn) = router.quoteJob(agentId);
        assertEq(price, 400 ether);
        assertGt(ethIn, 0);
        emit log_named_uint("ETH (wei) for 400 WIF", ethIn);

        uint256 supply = WIF.totalSupply();
        uint256 sent = ethIn * 103 / 100;
        vm.prank(buyer);
        uint256 spent = router.payWithEth{value: sent}(agentId, "job1", price);

        assertLe(spent, sent);
        assertEq(buyer.balance, 1 ether - spent, "unspent ETH comes back");
        assertEq(address(router).balance, 0, "router keeps no ETH");
        assertEq(WIF.balanceOf(address(router)), 0, "router keeps no WIF");
        assertEq(WIF.balanceOf(seller), 396 ether, "seller gets the price minus the 1% burn");
        assertEq(WIF.totalSupply(), supply - 4 ether, "1% burned");
        (address jobBuyer,,,,) = market.jobs("job1");
        assertEq(jobBuyer, buyer, "the ETH payer owns the job");

        // a failed job refunds the buyer in $WIF
        vm.prank(arbiter);
        market.refund("job1");
        assertEq(WIF.balanceOf(buyer), 400 ether);
    }

    function test_revertsWhenEthIsShort() public {
        if (!forked) return;
        (uint256 price, uint256 ethIn) = router.quoteJob(agentId);
        vm.prank(buyer);
        vm.expectRevert();
        router.payWithEth{value: ethIn / 2}(agentId, "job2", price);
    }

    function test_quoteAndPayWithUsdg() public {
        if (!forked) return;
        (uint256 price, uint256 usdgIn) = router.quoteJobUsdg(agentId);
        assertEq(price, 400 ether);
        assertGt(usdgIn, 0);
        emit log_named_uint("USDG (6 dp) for 400 WIF", usdgIn);

        deal(address(USDG), buyer, 100e6);
        uint256 supply = WIF.totalSupply();
        vm.startPrank(buyer);
        USDG.approve(address(router), type(uint256).max);
        uint256 spent = router.payWithUsdg(agentId, "usdg-job", price, usdgIn * 102 / 100);
        vm.stopPrank();

        assertEq(spent, usdgIn, "pays exactly the quote when nothing moved");
        assertEq(USDG.balanceOf(buyer), 100e6 - spent);
        assertEq(USDG.balanceOf(address(router)), 0, "router keeps no USDG");
        assertEq(WIF.balanceOf(address(router)), 0, "router keeps no WIF");
        assertEq(WIF.balanceOf(seller), 396 ether, "seller gets the price minus the 1% burn");
        assertEq(supply - WIF.totalSupply(), 4 ether, "1% burned");
    }

    function test_usdgSlippageGuard() public {
        if (!forked) return;
        (, uint256 usdgIn) = router.quoteJobUsdg(agentId);
        deal(address(USDG), buyer, 100e6);
        vm.startPrank(buyer);
        USDG.approve(address(router), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(PayRouter.NotEnoughUsdg.selector, usdgIn));
        router.payWithUsdg(agentId, "usdg-job", 400 ether, usdgIn - 1);
        vm.stopPrank();
    }

    function test_usdgCallbackOnlyFromPool() public {
        if (!forked) return;
        vm.expectRevert(PayRouter.OnlyUsdgPool.selector);
        router.uniswapV3SwapCallback(0, 1, abi.encode(uint256(1), false));
    }
}
