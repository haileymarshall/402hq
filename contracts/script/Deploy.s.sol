// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {AgentMarket, IERC20Burnable} from "../src/AgentMarket.sol";

/// forge script script/Deploy.s.sol --rpc-url $RPC_URL --private-key $PRIVATE_KEY --broadcast
contract Deploy is Script {
    address constant WIF = 0x5173b8eA6923c2d40267890D45C46a3480954773;

    function run() external returns (AgentMarket market) {
        address arbiter = vm.envAddress("ARBITER");
        uint256 minBond = vm.envOr("MIN_BOND", uint256(100 ether));
        uint256 window = vm.envOr("DISPUTE_WINDOW", uint256(1 days));
        uint256 cooldown = vm.envOr("COOLDOWN", uint256(2 days));

        vm.startBroadcast();
        market = new AgentMarket(IERC20Burnable(WIF), minBond, window, cooldown, arbiter);
        vm.stopBroadcast();
        console.log("AgentMarket", address(market));
    }
}
