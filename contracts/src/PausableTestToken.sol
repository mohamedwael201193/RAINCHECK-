// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title PausableTestToken
/// @notice TEST-ONLY ERC20 used to prove RaincheckEscrowFP's freeze-proof path
///         on Arc mainnet. Has NO economic value and is not part of the product.
/// @dev `pause()` makes every transfer revert, simulating a frozen/blacklisted
///      token (real USDC freeze cannot be induced on mainnet without Circle
///      blacklisting an address — this mock stands in for the token-side
///      failure mode, documented honestly in PROOFS.md).
contract PausableTestToken {
    string public name = "Pausable Test Token";
    string public symbol = "PTT";
    uint8 public decimals = 6;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    bool public paused;
    address public owner;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Paused();
    event Unpaused();

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(uint256 initialSupply) {
        owner = msg.sender;
        balanceOf[msg.sender] = initialSupply;
        emit Transfer(address(0), msg.sender, initialSupply);
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused();
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused();
    }

    function _move(address from, address to, uint256 amount) internal {
        require(!paused, "token paused");
        require(to != address(0), "to zero");
        require(balanceOf[from] >= amount, "insufficient");
        unchecked {
            balanceOf[from] -= amount;
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        unchecked {
            allowance[from][msg.sender] = allowed - amount;
        }
        _move(from, to, amount);
        return true;
    }
}
