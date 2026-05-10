// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {DigitalTablet} from "../src/DigitalTablet.sol";

/// @title  DigitalTablet 部署腳本
/// @notice 從環境變數 DEPLOYER_PRIVATE_KEY 取私鑰,部署 DigitalTablet。
///         部署後在 console 列印合約地址,記得貼回 .env 的 CONTRACT_ADDRESS
///         與 NEXT_PUBLIC_CONTRACT_ADDRESS 兩個欄位。
/// @dev    執行範例 (PowerShell):
///   . .\load-env.ps1
///   cd contracts
///   forge script script/Deploy.s.sol:Deploy --rpc-url $env:RPC_URL --broadcast
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
