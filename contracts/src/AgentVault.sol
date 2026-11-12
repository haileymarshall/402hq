// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {AgentMarket} from "./AgentMarket.sol";

/// @title AgentVault
/// @notice A $WIF wallet for one AI agent. The owner funds it and sets the rules; the agent's key (operator) can only
///         hire sellers on the market that pass those rules. Refunds for failed jobs come back here.
contract AgentVault {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;

    AgentMarket public immutable market;
    IERC20 public immutable wif;
    address public owner;
    address public operator;

    struct Rules {
        uint128 dailyCap;
        uint128 perJobCap;
        /// @notice seller's bond + stake must be at least this
        uint256 minSellerBacking;
        /// @notice failed / (done + failed) must stay at or under this
        uint16 maxSellerFailBps;
    }

    Rules public rules;
    mapping(uint256 => uint256) public spentOnDay;

    event RulesSet(Rules rules);
    event OperatorSet(address operator);
    event Hired(uint256 indexed agentId, bytes32 indexed jobId, uint256 price);
    event Withdrawn(address to, uint256 amount);

    error NotOwner();
    error NotOperator();
    error RuleBroken(string rule);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(AgentMarket market_, address owner_, address operator_, Rules memory rules_) {
        market = market_;
        wif = IERC20(address(market_.wif()));
        owner = owner_;
        operator = operator_;
        rules = rules_;
        emit OperatorSet(operator_);
        emit RulesSet(rules_);
    }

    function setRules(Rules calldata rules_) external onlyOwner {
        rules = rules_;
        emit RulesSet(rules_);
    }

    function setOperator(address operator_) external onlyOwner {
        operator = operator_;
        emit OperatorSet(operator_);
    }

    function transferOwnership(address owner_) external onlyOwner {
        owner = owner_;
    }

    function withdraw(address to, uint256 amount) external onlyOwner {
        wif.safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }

    /// @notice Reverts with the broken rule's name, so the agent (and the UI) can explain why it didn't hire.
    function check(uint256 agentId) public view returns (uint256 price) {
        (uint256 p, bool active, uint256 backing, uint64 done, uint64 failed) = market.sellerInfo(agentId);
        Rules memory r = rules;
        if (!active) revert RuleBroken("seller inactive");
        if (p > r.perJobCap) revert RuleBroken("per-job cap");
        if (spentOnDay[block.timestamp / 1 days] + p > r.dailyCap) revert RuleBroken("daily cap");
        if (backing < r.minSellerBacking) revert RuleBroken("seller backing too low");
        uint256 jobs = uint256(done) + failed;
        if (jobs > 0 && uint256(failed) * BPS / jobs > r.maxSellerFailBps) revert RuleBroken("seller fail rate");
        return p;
    }

    function hire(uint256 agentId, bytes32 jobId) external returns (uint256 price) {
        if (msg.sender != operator) revert NotOperator();
        price = check(agentId);
        spentOnDay[block.timestamp / 1 days] += price;
        wif.forceApprove(address(market), price);
        market.pay(agentId, jobId, price);
        emit Hired(agentId, jobId, price);
    }
}
