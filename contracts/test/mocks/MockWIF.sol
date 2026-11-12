// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "openzeppelin-contracts/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/// @dev Same surface as the live $WIF: ERC20 + burn/burnFrom, no permit.
contract MockWIF is ERC20Burnable {
    constructor() ERC20("World is Flat", "WIF") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
