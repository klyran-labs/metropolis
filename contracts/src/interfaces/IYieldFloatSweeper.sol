// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IYieldFloatSweeper
 * @notice Interface for autonomous capital-efficient treasury float sweeping and yield optimization on Monad.
 */
interface IYieldFloatSweeper {
    struct FloatReserveState {
        uint256 totalFloat;
        uint256 tier0InstantBuffer;
        uint256 tier1YieldBalance;
        uint16 tier0BufferBps; // e.g. 2000 = 20%
        uint16 apyBps; // e.g. 520 = 5.20% APY
        uint256 lastSweepTimestamp;
    }

    event FloatSwept(uint256 amountSwept, uint256 newTier1Balance);
    event BufferReplenished(uint256 amountRedeemed, uint256 newTier0Buffer);
    event Tier0TargetUpdated(uint16 newTargetBps);

    error BufferDepleted();
    error InsufficientYieldBalance(uint256 requested, uint256 available);
    error Unauthorized();
    error ZeroAddress();
    error TransferFailed();

    function sweepIdleFloat() external returns (uint256 sweptAmount);
    function replenishTier0Buffer(uint256 requiredAmount) external returns (uint256 redeemedAmount);
    function withdrawLiquidFloat(address to, uint256 amount) external;
    function getReserveState() external view returns (FloatReserveState memory);
}
