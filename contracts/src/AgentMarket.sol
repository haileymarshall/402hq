// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "openzeppelin-contracts/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

interface IERC20Burnable is IERC20 {
    function burn(uint256 amount) external;
}

/// @title AgentMarket
/// @notice A marketplace where AI agents are hired per job in $WIF. Every job is insured by the agent owner's bond
///         plus $WIF staked by backers. Backers earn a cut of every sale and are slashed (after the owner's bond)
///         when the agent fails a buyer.
contract AgentMarket is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20Burnable;

    uint256 public constant BPS = 10_000;
    /// @notice share of every payment that is burned
    uint256 public constant BURN_BPS = 100;
    /// @notice extra burned on top of a refund, taken from the insurance
    uint256 public constant PENALTY_BPS = 1_000;
    /// @notice the most an agent can share with its backers
    uint256 public constant MAX_BACKER_BPS = 5_000;
    uint256 private constant ACC = 1e18;

    IERC20Burnable public immutable wif;
    uint256 public immutable minBond;
    /// @notice how long after payment a job can be refunded; also the capacity epoch
    uint256 public immutable disputeWindow;
    /// @notice wait between asking to unstake (or unbond) and withdrawing; longer than the dispute window
    uint256 public immutable cooldown;

    address public arbiter;

    struct Agent {
        address owner;
        address payout;
        uint128 price;
        uint16 backerBps;
        bool active;
        uint64 jobsDone;
        uint64 jobsFailed;
        uint256 bond;
        uint256 bondUnlockAt;
        uint256 totalStake;
        uint256 totalShares;
        uint256 accRewardPerShare;
        string service;
        string endpoint;
    }

    struct Position {
        uint256 shares;
        uint256 rewardDebt;
        uint256 unlockAt;
    }

    enum JobStatus {
        None,
        Paid,
        Refunded
    }

    struct Job {
        address buyer;
        uint64 agentId;
        uint32 paidAt;
        JobStatus status;
        uint128 amount;
    }

    uint256 public agentCount;
    mapping(uint256 => Agent) internal _agents;
    mapping(uint256 => mapping(address => Position)) public positions;
    mapping(uint256 => mapping(uint256 => uint256)) public salesInEpoch;
    mapping(bytes32 => Job) public jobs;
    uint256 public totalBurned;

    event ArbiterSet(address arbiter);
    event AgentRegistered(uint256 indexed agentId, address indexed owner, string service, uint256 price, uint256 bond);
    event AgentUpdated(uint256 indexed agentId, uint256 price, uint16 backerBps, bool active, string endpoint);
    event BondAdded(uint256 indexed agentId, uint256 amount);
    event BondUnlockRequested(uint256 indexed agentId, uint256 unlockAt);
    event BondWithdrawn(uint256 indexed agentId, uint256 amount);
    event Staked(uint256 indexed agentId, address indexed backer, uint256 amount, uint256 shares);
    event UnstakeRequested(uint256 indexed agentId, address indexed backer, uint256 unlockAt);
    event Unstaked(uint256 indexed agentId, address indexed backer, uint256 amount, uint256 shares);
    event RewardClaimed(uint256 indexed agentId, address indexed backer, uint256 amount);
    event JobPaid(
        bytes32 indexed jobId,
        uint256 indexed agentId,
        address indexed buyer,
        uint256 amount,
        uint256 burned,
        uint256 backerCut
    );
    event JobRefunded(
        bytes32 indexed jobId,
        uint256 indexed agentId,
        address indexed buyer,
        uint256 refunded,
        uint256 burned,
        uint256 fromBond,
        uint256 fromStake
    );

    error NotAgentOwner();
    error NotArbiter();
    error BadParams();
    error AgentInactive();
    error PriceAboveMax();
    error OverCapacity();
    error JobExists();
    error JobNotRefundable();
    error StillLocked();
    error NothingToWithdraw();
    error PoolWiped();

    modifier onlyAgentOwner(uint256 agentId) {
        if (_agents[agentId].owner != msg.sender) revert NotAgentOwner();
        _;
    }

    constructor(IERC20Burnable wif_, uint256 minBond_, uint256 disputeWindow_, uint256 cooldown_, address arbiter_)
        Ownable(msg.sender)
    {
        if (address(wif_) == address(0) || disputeWindow_ == 0 || cooldown_ <= disputeWindow_) revert BadParams();
        wif = wif_;
        minBond = minBond_;
        disputeWindow = disputeWindow_;
        cooldown = cooldown_;
        arbiter = arbiter_;
        emit ArbiterSet(arbiter_);
    }

    function setArbiter(address arbiter_) external onlyOwner {
        arbiter = arbiter_;
        emit ArbiterSet(arbiter_);
    }

    // ---------------------------------------------------------------- agents

    function registerAgent(
        string calldata service,
        string calldata endpoint,
        uint128 price,
        uint16 backerBps,
        address payout,
        uint256 bond
    ) external nonReentrant returns (uint256 agentId) {
        if (price == 0 || backerBps > MAX_BACKER_BPS || payout == address(0) || bond < minBond) {
            revert BadParams();
        }
        agentId = ++agentCount;
        Agent storage a = _agents[agentId];
        a.owner = msg.sender;
        a.payout = payout;
        a.price = price;
        a.backerBps = backerBps;
        a.active = true;
        a.bond = bond;
        a.service = service;
        a.endpoint = endpoint;
        wif.safeTransferFrom(msg.sender, address(this), bond);
        emit AgentRegistered(agentId, msg.sender, service, price, bond);
    }

    /// @notice The backer share can only go up, so an owner can't attract stake and then cut its yield.
    function updateAgent(uint256 agentId, uint128 price, uint16 backerBps, string calldata endpoint, bool active)
        external
        onlyAgentOwner(agentId)
    {
        Agent storage a = _agents[agentId];
        if (price == 0 || backerBps < a.backerBps || backerBps > MAX_BACKER_BPS) revert BadParams();
        if (active && (a.bond < minBond || a.bondUnlockAt != 0)) revert BadParams();
        a.price = price;
        a.backerBps = backerBps;
        a.endpoint = endpoint;
        a.active = active;
        emit AgentUpdated(agentId, price, backerBps, active, endpoint);
    }

    function addBond(uint256 agentId, uint256 amount) external nonReentrant onlyAgentOwner(agentId) {
        Agent storage a = _agents[agentId];
        if (a.bondUnlockAt != 0) revert BadParams();
        a.bond += amount;
        wif.safeTransferFrom(msg.sender, address(this), amount);
        emit BondAdded(agentId, amount);
    }

    /// @notice Stops the agent taking jobs and starts the bond cooldown. Recent jobs stay refundable meanwhile.
    function requestBondUnlock(uint256 agentId) external onlyAgentOwner(agentId) {
        Agent storage a = _agents[agentId];
        a.active = false;
        a.bondUnlockAt = block.timestamp + cooldown;
        emit BondUnlockRequested(agentId, a.bondUnlockAt);
    }

    function withdrawBond(uint256 agentId) external nonReentrant onlyAgentOwner(agentId) {
        Agent storage a = _agents[agentId];
        if (a.bondUnlockAt == 0 || block.timestamp < a.bondUnlockAt) revert StillLocked();
        uint256 amount = a.bond;
        if (amount == 0) revert NothingToWithdraw();
        a.bond = 0;
        wif.safeTransfer(msg.sender, amount);
        emit BondWithdrawn(agentId, amount);
    }

    // ---------------------------------------------------------------- backing

    function stake(uint256 agentId, uint256 amount) external nonReentrant {
        Agent storage a = _agents[agentId];
        if (a.owner == address(0) || amount == 0) revert BadParams();
        Position storage p = positions[agentId][msg.sender];
        _harvest(agentId, a, p, msg.sender);

        // a pool slashed to zero keeps its old (worthless) shares; new stake would be diluted by them
        if (a.totalStake == 0 && a.totalShares != 0) revert PoolWiped();
        uint256 shares = a.totalShares == 0 ? amount : amount * a.totalShares / a.totalStake;
        if (shares == 0) revert BadParams();
        a.totalStake += amount;
        a.totalShares += shares;
        p.shares += shares;
        p.unlockAt = 0;
        p.rewardDebt = p.shares * a.accRewardPerShare / ACC;
        wif.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(agentId, msg.sender, amount, shares);
    }

    /// @notice Starts the cooldown. The stake keeps earning and stays slashable until it is withdrawn.
    function requestUnstake(uint256 agentId) external {
        Position storage p = positions[agentId][msg.sender];
        if (p.shares == 0) revert NothingToWithdraw();
        p.unlockAt = block.timestamp + cooldown;
        emit UnstakeRequested(agentId, msg.sender, p.unlockAt);
    }

    function unstake(uint256 agentId) external nonReentrant {
        Agent storage a = _agents[agentId];
        Position storage p = positions[agentId][msg.sender];
        if (p.shares == 0) revert NothingToWithdraw();
        if (p.unlockAt == 0 || block.timestamp < p.unlockAt) revert StillLocked();
        _harvest(agentId, a, p, msg.sender);

        uint256 shares = p.shares;
        uint256 amount = shares * a.totalStake / a.totalShares;
        a.totalStake -= amount;
        a.totalShares -= shares;
        p.shares = 0;
        p.rewardDebt = 0;
        p.unlockAt = 0;
        if (amount > 0) wif.safeTransfer(msg.sender, amount);
        emit Unstaked(agentId, msg.sender, amount, shares);
    }

    function claim(uint256 agentId) external nonReentrant {
        Agent storage a = _agents[agentId];
        Position storage p = positions[agentId][msg.sender];
        _harvest(agentId, a, p, msg.sender);
        p.rewardDebt = p.shares * a.accRewardPerShare / ACC;
    }

    function _harvest(uint256 agentId, Agent storage a, Position storage p, address to) internal {
        if (p.shares == 0) return;
        uint256 owed = p.shares * a.accRewardPerShare / ACC - p.rewardDebt;
        if (owed > 0) {
            p.rewardDebt += owed;
            wif.safeTransfer(to, owed);
            emit RewardClaimed(agentId, to, owed);
        }
    }

    // ---------------------------------------------------------------- jobs

    /// @notice Pay for one job. The buyer must have approved this contract for at least the price.
    /// @param maxPrice guards against the owner raising the price between quote and payment
    function pay(uint256 agentId, bytes32 jobId, uint256 maxPrice) external nonReentrant {
        _pay(agentId, jobId, maxPrice, msg.sender);
    }

    /// @notice Pay for a job on someone else's behalf. The caller supplies the $WIF; `buyer` owns the job and
    ///         receives any refund. Lets a router take ETH or a stablecoin, buy $WIF and settle in one transaction.
    function payFor(uint256 agentId, bytes32 jobId, uint256 maxPrice, address buyer) external nonReentrant {
        if (buyer == address(0)) revert BadParams();
        _pay(agentId, jobId, maxPrice, buyer);
    }

    function _pay(uint256 agentId, bytes32 jobId, uint256 maxPrice, address buyer) internal {
        Agent storage a = _agents[agentId];
        if (!a.active) revert AgentInactive();
        uint256 amount = a.price;
        if (amount > maxPrice) revert PriceAboveMax();
        if (jobs[jobId].status != JobStatus.None) revert JobExists();

        // sales across the current and previous epoch can't exceed what the insurance can refund
        uint256 epoch = block.timestamp / disputeWindow;
        uint256 exposure = salesInEpoch[agentId][epoch] + (epoch == 0 ? 0 : salesInEpoch[agentId][epoch - 1]);
        if (exposure + amount > capacity(agentId)) revert OverCapacity();
        salesInEpoch[agentId][epoch] += amount;

        jobs[jobId] = Job({
            buyer: buyer,
            agentId: uint64(agentId),
            paidAt: uint32(block.timestamp),
            status: JobStatus.Paid,
            amount: uint128(amount)
        });
        a.jobsDone += 1;

        wif.safeTransferFrom(msg.sender, address(this), amount);

        uint256 burned = amount * BURN_BPS / BPS;
        uint256 rest = amount - burned;
        uint256 backerCut = a.totalShares == 0 ? 0 : rest * a.backerBps / BPS;
        if (backerCut > 0) a.accRewardPerShare += backerCut * ACC / a.totalShares;

        _burn(burned);
        wif.safeTransfer(a.payout, rest - backerCut);
        emit JobPaid(jobId, agentId, buyer, amount, burned, backerCut);
    }

    /// @notice The arbiter refunds a failed job inside the dispute window. The refund plus a burned penalty come out
    ///         of the owner's bond first, then pro rata from backers. The buyer never gets back more than they paid.
    function refund(bytes32 jobId) external nonReentrant {
        if (msg.sender != arbiter) revert NotArbiter();
        Job storage j = jobs[jobId];
        if (j.status != JobStatus.Paid || block.timestamp > uint256(j.paidAt) + disputeWindow) {
            revert JobNotRefundable();
        }
        j.status = JobStatus.Refunded;
        Agent storage a = _agents[j.agentId];
        a.jobsDone -= 1;
        a.jobsFailed += 1;

        uint256 owed = j.amount;
        uint256 penalty = owed * PENALTY_BPS / BPS;
        uint256 total = owed + penalty;

        uint256 fromBond = total < a.bond ? total : a.bond;
        a.bond -= fromBond;
        uint256 fromStake = total - fromBond;
        if (fromStake > a.totalStake) fromStake = a.totalStake;
        a.totalStake -= fromStake;

        uint256 available = fromBond + fromStake;
        uint256 refunded = available < owed ? available : owed;
        uint256 burned = available - refunded;

        if (a.bond < minBond) a.active = false;

        _burn(burned);
        if (refunded > 0) wif.safeTransfer(j.buyer, refunded);
        emit JobRefunded(jobId, j.agentId, j.buyer, refunded, burned, fromBond, fromStake);
    }

    function _burn(uint256 amount) internal {
        if (amount == 0) return;
        totalBurned += amount;
        wif.burn(amount);
    }

    // ---------------------------------------------------------------- views

    /// @notice the most an agent can sell within any dispute window
    function capacity(uint256 agentId) public view returns (uint256) {
        Agent storage a = _agents[agentId];
        return a.bond + a.totalStake;
    }

    function getAgent(uint256 agentId) external view returns (Agent memory) {
        return _agents[agentId];
    }

    /// @notice the facts an AgentVault checks before hiring
    function sellerInfo(uint256 agentId)
        external
        view
        returns (uint256 price, bool active, uint256 backing, uint64 jobsDone, uint64 jobsFailed)
    {
        Agent storage a = _agents[agentId];
        return (a.price, a.active, a.bond + a.totalStake, a.jobsDone, a.jobsFailed);
    }

    function stakeOf(uint256 agentId, address backer) external view returns (uint256) {
        Agent storage a = _agents[agentId];
        if (a.totalShares == 0) return 0;
        return positions[agentId][backer].shares * a.totalStake / a.totalShares;
    }

    function pendingReward(uint256 agentId, address backer) external view returns (uint256) {
        Position storage p = positions[agentId][backer];
        return p.shares * _agents[agentId].accRewardPerShare / ACC - p.rewardDebt;
    }
}
