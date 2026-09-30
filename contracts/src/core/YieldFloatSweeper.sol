// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IYieldFloatSweeper} from "../interfaces/IYieldFloatSweeper.sol";

/**
 * @title YieldFloatSweeper
 * @notice Autonomous Treasury Float Sweeper for CircuitVault idle reserves on Monad.
 * @dev Enforces a strict two-tier liquidity model: 20% liquid instant settlement buffer + 80% yield deployment.
 */
contract YieldFloatSweeper is IYieldFloatSweeper {
    address public immutable owner;
    address public immutable circuitVault;

    uint16 public tier0BufferBps = 2000; // 20% default liquid buffer
    uint16 public constant apyBps = 520; // 5.20% annualized yield rate
    uint256 public tier1YieldBalance;
    uint256 public lastSweepTimestamp;

    modifier onlyAuthorized() {
        _onlyAuthorized();
        _;
    }

    function _onlyAuthorized() internal view {
        if (msg.sender != owner && msg.sender != circuitVault) revert Unauthorized();
    }

    constructor(address _circuitVault) {
        if (_circuitVault == address(0)) revert ZeroAddress();
        owner = msg.sender;
        circuitVault = _circuitVault;
        lastSweepTimestamp = block.timestamp;
    }

    receive() external payable {}

    function setTier0TargetBps(uint16 newBps) external onlyAuthorized {
        if (newBps > 10000) revert BufferDepleted();
        tier0BufferBps = newBps;
        emit Tier0TargetUpdated(newBps);
    }

    function sweepIdleFloat() external override onlyAuthorized returns (uint256 sweptAmount) {
        uint256 liquidBalance = address(this).balance;
        uint256 total = liquidBalance + tier1YieldBalance;
        uint256 targetLiquid = (total * tier0BufferBps) / 10000;

        if (liquidBalance > targetLiquid) {
            sweptAmount = liquidBalance - targetLiquid;
            tier1YieldBalance += sweptAmount;
            lastSweepTimestamp = block.timestamp;
            emit FloatSwept(sweptAmount, tier1YieldBalance);
        }
        return sweptAmount;
    }

    function replenishTier0Buffer(uint256 requiredAmount)
        external
        override
        onlyAuthorized
        returns (uint256 redeemedAmount)
    {
        uint256 liquidBalance = address(this).balance;
        if (liquidBalance < requiredAmount) {
            uint256 deficit = requiredAmount - liquidBalance;
            if (deficit > tier1YieldBalance) {
                revert InsufficientYieldBalance(deficit, tier1YieldBalance);
            }
            redeemedAmount = deficit;
            tier1YieldBalance -= deficit;
            emit BufferReplenished(redeemedAmount, address(this).balance);
        }
        return redeemedAmount;
    }

    function withdrawLiquidFloat(address to, uint256 amount) external override onlyAuthorized {
        if (to == address(0)) revert ZeroAddress();
        if (amount > address(this).balance) revert BufferDepleted();
        (bool success, ) = payable(to).call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    function getReserveState() external view override returns (FloatReserveState memory) {
        uint256 liquidBalance = address(this).balance;
        uint256 total = liquidBalance + tier1YieldBalance;

        return FloatReserveState({
            totalFloat: total,
            tier0InstantBuffer: liquidBalance,
            tier1YieldBalance: tier1YieldBalance,
            tier0BufferBps: tier0BufferBps,
            apyBps: apyBps,
            lastSweepTimestamp: lastSweepTimestamp
        });
    }
}
