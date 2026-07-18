// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title CredentialRegistry
/// @notice Minimal on-chain registry for credential hashes.
/// @dev Stores only hash evidence and lifecycle timestamps, never raw credential data or PII.
contract CredentialRegistry {
    error ZeroCredentialHash();
    error CredentialAlreadyRegistered(bytes32 credentialHash);
    error CredentialNotRegistered(bytes32 credentialHash);
    error UnauthorizedRevoker(address caller);
    error CredentialAlreadyRevoked(bytes32 credentialHash);

    struct CredentialRecord {
        bool exists;
        bool revoked;
        address issuer;
        uint256 registeredAt;
        uint256 revokedAt;
    }

    mapping(bytes32 credentialHash => CredentialRecord record) private credentialRecords;

    event CredentialRegistered(
        bytes32 indexed credentialHash,
        address indexed issuer,
        uint256 registeredAt
    );

    event CredentialRevoked(
        bytes32 indexed credentialHash,
        address indexed issuer,
        uint256 revokedAt
    );

    /// @notice Registers a credential hash and records the sender as issuer/registrant.
    /// @param credentialHash Hash of the canonical credential payload.
    function registerCredential(bytes32 credentialHash) external {
        if (credentialHash == bytes32(0)) {
            revert ZeroCredentialHash();
        }

        CredentialRecord storage record = credentialRecords[credentialHash];
        if (record.exists) {
            revert CredentialAlreadyRegistered(credentialHash);
        }

        uint256 registeredAt = block.timestamp;

        credentialRecords[credentialHash] = CredentialRecord({
            exists: true,
            revoked: false,
            issuer: msg.sender,
            registeredAt: registeredAt,
            revokedAt: 0
        });

        emit CredentialRegistered(credentialHash, msg.sender, registeredAt);
    }

    /// @notice Revokes a previously registered credential hash.
    /// @param credentialHash Hash of the canonical credential payload.
    function revokeCredential(bytes32 credentialHash) external {
        if (credentialHash == bytes32(0)) {
            revert ZeroCredentialHash();
        }

        CredentialRecord storage record = credentialRecords[credentialHash];
        if (!record.exists) {
            revert CredentialNotRegistered(credentialHash);
        }
        if (record.issuer != msg.sender) {
            revert UnauthorizedRevoker(msg.sender);
        }
        if (record.revoked) {
            revert CredentialAlreadyRevoked(credentialHash);
        }

        uint256 revokedAt = block.timestamp;

        record.revoked = true;
        record.revokedAt = revokedAt;

        emit CredentialRevoked(credentialHash, msg.sender, revokedAt);
    }

    /// @notice Returns the current lifecycle state for a credential hash.
    function getCredentialStatus(bytes32 credentialHash)
        external
        view
        returns (
            bool exists,
            bool revoked,
            address issuer,
            uint256 registeredAt,
            uint256 revokedAt
        )
    {
        CredentialRecord storage record = credentialRecords[credentialHash];

        return (
            record.exists,
            record.revoked,
            record.issuer,
            record.registeredAt,
            record.revokedAt
        );
    }
}
