// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentMarket, IERC20Burnable} from "../src/AgentMarket.sol";

/// Runs against the live $WIF on a Robinhood Chain fork: FORK_URL=<rpc> forge test --match-contract Fork
contract ForkTest is Test {
    IERC20Burnable constant WIF = IERC20Burnable(0x5173b8eA6923c2d40267890D45C46a3480954773);

    function test_realWifPayBurnRefund() public {
        string memory url = vm.envOr("FORK_URL", string(""));
        if (bytes(url).length == 0) return;
        vm.createSelectFork(url);

        address arbiter = makeAddr("arbiter");
        address seller = makeAddr("seller");
        address buyer = makeAddr("buyer");
        AgentMarket market = new AgentMarket(WIF, 100 ether, 1 hours, 2 hours, arbiter);

        deal(address(WIF), seller, 1_000 ether);
        deal(address(WIF), buyer, 1_000 ether);
        vm.prank(seller);
        WIF.approve(address(market), type(uint256).max);
        vm.prank(buyer);
        WIF.approve(address(market), type(uint256).max);

        vm.prank(seller);
        uint256 id = market.registerAgent("contract-scan", "e", 10 ether, 0, seller, 100 ether);

        uint256 supply = WIF.totalSupply();
        vm.prank(buyer);
        market.pay(id, "job1", 10 ether);
        assertEq(WIF.totalSupply(), supply - 0.1 ether);

        vm.prank(arbiter);
        market.refund("job1");
        assertEq(WIF.balanceOf(buyer), 1_000 ether);
        assertEq(WIF.totalSupply(), supply - 0.1 ether - 1 ether);
    }
}
