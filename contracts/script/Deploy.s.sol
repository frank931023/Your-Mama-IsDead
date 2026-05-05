// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {DigitalTablet} from "../src/DigitalTablet.sol";

/// @title  Deploy
/// @notice Deploys DigitalTablet using DEPLOYER_PRIVATE_KEY from env.
/// @dev    Run:
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url $SEPOLIA_RPC_URL --broadcast --verify -vvvv
contract Deploy is Script {
    function run() external returns (DigitalTablet tablet) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);

        console2.log("Deployer:", deployer);
        console2.log("Chain id:", block.chainid);

        vm.startBroadcast(pk);
        tablet = new DigitalTablet();
        vm.stopBroadcast();

        console2.log("DigitalTablet deployed at:", address(tablet));
        console2.log("name:", tablet.name());
        console2.log("symbol:", tablet.symbol());
    }
}
