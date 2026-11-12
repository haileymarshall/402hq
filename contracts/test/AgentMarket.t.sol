// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentMarket, IERC20Burnable} from "../src/AgentMarket.sol";
import {AgentVault} from "../src/AgentVault.sol";
import {MockWIF} from "./mocks/MockWIF.sol";

contract AgentMarketTest is Test {
    MockWIF wif;
    AgentMarket market;

    address arbiter = makeAddr("arbiter");
    address seller = makeAddr("seller");
    address payout = makeAddr("payout");
    address buyer = makeAddr("buyer");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 constant MIN_BOND = 100 ether;
    uint256 constant WINDOW = 1 hours;
    uint256 constant COOLDOWN = 2 hours;
    uint128 constant PRICE = 10 ether;

    function setUp() public {
        wif = new MockWIF();
        market = new AgentMarket(IERC20Burnable(address(wif)), MIN_BOND, WINDOW, COOLDOWN, arbiter);
        address[5] memory users = [seller, buyer, alice, bob, address(this)];
        for (uint256 i; i < users.length; i++) {
            wif.mint(users[i], 10_000 ether);
            vm.prank(users[i]);
            wif.approve(address(market), type(uint256).max);
        }
    }

    function _register(uint16 backerBps) internal returns (uint256 id) {
        vm.prank(seller);
        id = market.registerAgent("contract-scan", "https://x/scan", PRICE, backerBps, payout, MIN_BOND);
    }

    function _pay(uint256 id, bytes32 jobId) internal {
        vm.prank(buyer);
        market.pay(id, jobId, PRICE);
    }

    function test_registerNeedsMinBond() public {
        vm.prank(seller);
        vm.expectRevert(AgentMarket.BadParams.selector);
        market.registerAgent("s", "e", PRICE, 0, payout, MIN_BOND - 1);
    }

    function test_paySplitsBurnBackersAndPayout() public {
        uint256 id = _register(2_000);
        vm.prank(alice);
        market.stake(id, 300 ether);

        uint256 supplyBefore = wif.totalSupply();
        _pay(id, "job1");

        uint256 burned = PRICE / 100; // 1%
        uint256 rest = PRICE - burned;
        uint256 cut = rest * 2_000 / 10_000;
        assertEq(wif.totalSupply(), supplyBefore - burned);
        assertEq(market.totalBurned(), burned);
        assertEq(wif.balanceOf(payout), rest - cut);
        assertApproxEqAbs(market.pendingReward(id, alice), cut, 1);

        uint256 before = wif.balanceOf(alice);
        vm.prank(alice);
        market.claim(id);
        assertApproxEqAbs(wif.balanceOf(alice) - before, cut, 1);
        assertEq(market.pendingReward(id, alice), 0);
    }

    function test_noBackersMeansFullPayout() public {
        uint256 id = _register(2_000);
        _pay(id, "job1");
        assertEq(wif.balanceOf(payout), PRICE - PRICE / 100);
    }

    function test_rewardsSplitProRata() public {
        uint256 id = _register(5_000);
        vm.prank(alice);
        market.stake(id, 100 ether);
        vm.prank(bob);
        market.stake(id, 300 ether);
        _pay(id, "job1");
        uint256 a = market.pendingReward(id, alice);
        uint256 b = market.pendingReward(id, bob);
        assertApproxEqAbs(b, 3 * a, 3);
    }

    function test_lateStakerDoesNotGetOldRewards() public {
        uint256 id = _register(5_000);
        vm.prank(alice);
        market.stake(id, 100 ether);
        _pay(id, "job1");
        vm.prank(bob);
        market.stake(id, 100 ether);
        assertEq(market.pendingReward(id, bob), 0);
    }

    function test_priceGuardAndDuplicateJob() public {
        uint256 id = _register(0);
        vm.prank(buyer);
        vm.expectRevert(AgentMarket.PriceAboveMax.selector);
        market.pay(id, "job1", PRICE - 1);

        _pay(id, "job1");
        vm.prank(buyer);
        vm.expectRevert(AgentMarket.JobExists.selector);
        market.pay(id, "job1", PRICE);
    }

    function test_payForMakesTheBuyerOwnTheJob() public {
        uint256 id = _register(0);
        // alice supplies the $WIF, bob owns the job and gets the refund
        vm.prank(alice);
        market.payFor(id, "job1", PRICE, bob);
        assertEq(wif.balanceOf(alice), 10_000 ether - PRICE);
        (address jobBuyer,,,,) = market.jobs("job1");
        assertEq(jobBuyer, bob);

        vm.prank(arbiter);
        market.refund("job1");
        assertEq(wif.balanceOf(bob), 10_000 ether + PRICE);

        vm.prank(alice);
        vm.expectRevert(AgentMarket.BadParams.selector);
        market.payFor(id, "job2", PRICE, address(0));
    }

    function test_capacityLimitsSales() public {
        uint256 id = _register(0); // capacity = 100 WIF bond = 10 jobs
        for (uint256 i; i < 10; i++) {
            _pay(id, bytes32(i + 1));
        }
        vm.prank(buyer);
        vm.expectRevert(AgentMarket.OverCapacity.selector);
        market.pay(id, "job11", PRICE);

        // more backing, more capacity
        vm.prank(alice);
        market.stake(id, PRICE);
        _pay(id, "job11");

        // capacity frees up after two epochs
        vm.warp(block.timestamp + 2 * WINDOW);
        _pay(id, "job12");
    }

    function test_refundComesFromBondFirst() public {
        uint256 id = _register(0);
        vm.prank(alice);
        market.stake(id, 300 ether);
        _pay(id, "job1");

        uint256 buyerBefore = wif.balanceOf(buyer);
        vm.prank(arbiter);
        market.refund("job1");

        uint256 penalty = PRICE / 10;
        assertEq(wif.balanceOf(buyer) - buyerBefore, PRICE);
        assertEq(market.getAgent(id).bond, MIN_BOND - PRICE - penalty);
        assertEq(market.stakeOf(id, alice), 300 ether);
        assertEq(market.getAgent(id).jobsFailed, 1);
        assertEq(market.getAgent(id).jobsDone, 0);
        // bond fell under the minimum, so the agent stops taking jobs
        assertFalse(market.getAgent(id).active);
    }

    function test_refundSlashesBackersAfterBond() public {
        vm.prank(seller);
        uint256 id = market.registerAgent("s", "e", 100 ether, 0, payout, MIN_BOND);
        vm.prank(alice);
        market.stake(id, 100 ether);
        vm.prank(bob);
        market.stake(id, 100 ether);
        vm.prank(buyer);
        market.pay(id, "job1", 100 ether);

        vm.prank(arbiter);
        market.refund("job1"); // needs 110: 100 from bond, 10 from stake

        assertEq(market.getAgent(id).bond, 0);
        assertEq(market.stakeOf(id, alice), 95 ether);
        assertEq(market.stakeOf(id, bob), 95 ether);
    }

    function test_refundRules() public {
        uint256 id = _register(0);
        _pay(id, "job1");

        vm.expectRevert(AgentMarket.NotArbiter.selector);
        market.refund("job1");

        vm.warp(block.timestamp + WINDOW + 1);
        vm.prank(arbiter);
        vm.expectRevert(AgentMarket.JobNotRefundable.selector);
        market.refund("job1");
    }

    function test_cannotRefundTwice() public {
        uint256 id = _register(0);
        _pay(id, "job1");
        vm.startPrank(arbiter);
        market.refund("job1");
        vm.expectRevert(AgentMarket.JobNotRefundable.selector);
        market.refund("job1");
        vm.stopPrank();
    }

    function test_unstakeCooldownAndStillSlashable() public {
        vm.prank(seller);
        uint256 id = market.registerAgent("s", "e", 100 ether, 0, payout, MIN_BOND);
        vm.prank(alice);
        market.stake(id, 100 ether);
        vm.prank(buyer);
        market.pay(id, "job1", 100 ether);

        vm.prank(alice);
        market.requestUnstake(id);
        vm.prank(alice);
        vm.expectRevert(AgentMarket.StillLocked.selector);
        market.unstake(id);

        // the buyer reports the failure while alice waits out her cooldown
        vm.prank(arbiter);
        market.refund("job1");

        vm.warp(block.timestamp + COOLDOWN);
        uint256 before = wif.balanceOf(alice);
        vm.prank(alice);
        market.unstake(id);
        assertEq(wif.balanceOf(alice) - before, 90 ether);
    }

    function test_backerShareCanOnlyGoUp() public {
        uint256 id = _register(2_000);
        vm.prank(seller);
        vm.expectRevert(AgentMarket.BadParams.selector);
        market.updateAgent(id, PRICE, 1_000, "e", true);
        vm.prank(seller);
        market.updateAgent(id, PRICE, 3_000, "e", true);
        assertEq(market.getAgent(id).backerBps, 3_000);
    }

    function test_bondWithdrawAfterCooldown() public {
        uint256 id = _register(0);
        vm.prank(seller);
        market.requestBondUnlock(id);
        assertFalse(market.getAgent(id).active);

        vm.prank(buyer);
        vm.expectRevert(AgentMarket.AgentInactive.selector);
        market.pay(id, "job1", PRICE);

        vm.prank(seller);
        vm.expectRevert(AgentMarket.StillLocked.selector);
        market.withdrawBond(id);

        vm.warp(block.timestamp + COOLDOWN);
        uint256 before = wif.balanceOf(seller);
        vm.prank(seller);
        market.withdrawBond(id);
        assertEq(wif.balanceOf(seller) - before, MIN_BOND);
    }

    function test_wipedPoolRejectsNewStake() public {
        vm.prank(seller);
        uint256 id = market.registerAgent("s", "e", 100 ether, 0, payout, MIN_BOND);
        vm.prank(alice);
        market.stake(id, 1 ether);
        vm.prank(buyer);
        market.pay(id, "job1", 100 ether);
        vm.prank(arbiter);
        market.refund("job1");
        assertEq(market.getAgent(id).totalStake, 0);

        vm.prank(bob);
        vm.expectRevert(AgentMarket.PoolWiped.selector);
        market.stake(id, 10 ether);
    }

    // ---------------------------------------------------------------- vault

    function _vault(AgentVault.Rules memory r) internal returns (AgentVault v, address op) {
        op = makeAddr("operator");
        v = new AgentVault(market, address(this), op, r);
        wif.transfer(address(v), 1_000 ether);
    }

    function test_vaultHiresWithinRules() public {
        uint256 id = _register(0);
        (AgentVault v, address op) = _vault(AgentVault.Rules(100 ether, 20 ether, MIN_BOND, 1_000));
        vm.prank(op);
        v.hire(id, "job1");
        (address jobBuyer,,,,) = market.jobs("job1");
        assertEq(jobBuyer, address(v));
    }

    function test_vaultEnforcesRules() public {
        uint256 id = _register(0);
        (AgentVault v, address op) = _vault(AgentVault.Rules(15 ether, 20 ether, MIN_BOND, 1_000));

        vm.expectRevert(AgentVault.NotOperator.selector);
        v.hire(id, "job1");

        vm.startPrank(op);
        v.hire(id, "job1");
        vm.expectRevert(abi.encodeWithSelector(AgentVault.RuleBroken.selector, "daily cap"));
        v.hire(id, "job2");
        vm.stopPrank();

        v.setRules(AgentVault.Rules(1_000 ether, 5 ether, 0, 10_000));
        vm.prank(op);
        vm.expectRevert(abi.encodeWithSelector(AgentVault.RuleBroken.selector, "per-job cap"));
        v.hire(id, "job2");

        v.setRules(AgentVault.Rules(1_000 ether, 20 ether, MIN_BOND + 1, 10_000));
        vm.prank(op);
        vm.expectRevert(abi.encodeWithSelector(AgentVault.RuleBroken.selector, "seller backing too low"));
        v.hire(id, "job2");
    }

    function test_vaultSkipsSellersThatFail() public {
        uint256 id = _register(0);
        vm.prank(seller);
        market.addBond(id, 1_000 ether);
        (AgentVault v, address op) = _vault(AgentVault.Rules(1_000 ether, 20 ether, 0, 2_000));

        vm.prank(op);
        v.hire(id, "job1");
        vm.prank(arbiter);
        market.refund("job1"); // 1 of 1 jobs failed
        assertEq(wif.balanceOf(address(v)), 1_000 ether); // refunded in full

        vm.prank(op);
        vm.expectRevert(abi.encodeWithSelector(AgentVault.RuleBroken.selector, "seller fail rate"));
        v.hire(id, "job2");
    }
}
