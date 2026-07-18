// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "../src/CredentialRegistry.sol";

interface Vm {
    function prank(address msgSender) external;
    function expectRevert(bytes4 revertData) external;
    function expectRevert(bytes calldata revertData) external;
    function expectEmit(bool checkTopic1, bool checkTopic2, bool checkTopic3, bool checkData) external;
}

contract CredentialRegistryTest {
    address private constant VM_ADDRESS = address(uint160(uint256(keccak256("hevm cheat code"))));

    Vm private constant vm = Vm(VM_ADDRESS);

    CredentialRegistry private registry;

    address private constant ISSUER = address(0xA11CE);
    address private constant OTHER = address(0xB0B);
    bytes32 private constant VALID_HASH = keccak256("credential-hash-demo");

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

    function setUp() public {
        registry = new CredentialRegistry();
    }

    function testRegisterValidHash() public {
        vm.prank(ISSUER);
        registry.registerCredential(VALID_HASH);

        (bool exists, bool revoked, address issuer, uint256 registeredAt, uint256 revokedAt) =
            registry.getCredentialStatus(VALID_HASH);

        assertTrue(exists, "credential should exist after registration");
        assertFalse(revoked, "credential should not be revoked after registration");
        assertEq(issuer, ISSUER, "issuer should match msg.sender");
        assertGt(registeredAt, 0, "registeredAt should be populated");
        assertEq(revokedAt, 0, "revokedAt should be zero before revocation");
    }

    function testRegisterRejectsZeroHash() public {
        vm.expectRevert(CredentialRegistry.ZeroCredentialHash.selector);
        registry.registerCredential(bytes32(0));
    }

    function testRegisterRejectsDuplicateHash() public {
        vm.prank(ISSUER);
        registry.registerCredential(VALID_HASH);

        vm.prank(ISSUER);
        vm.expectRevert(
            abi.encodeWithSelector(
                CredentialRegistry.CredentialAlreadyRegistered.selector,
                VALID_HASH
            )
        );
        registry.registerCredential(VALID_HASH);
    }

    function testGetCredentialStatusForRegisteredHash() public {
        vm.prank(ISSUER);
        registry.registerCredential(VALID_HASH);

        (bool exists, bool revoked, address issuer, uint256 registeredAt, uint256 revokedAt) =
            registry.getCredentialStatus(VALID_HASH);

        assertTrue(exists, "registered hash should exist");
        assertFalse(revoked, "registered hash should not be revoked");
        assertEq(issuer, ISSUER, "issuer should be preserved");
        assertGt(registeredAt, 0, "registeredAt should be greater than zero");
        assertEq(revokedAt, 0, "revokedAt should still be zero");
    }

    function testRevokeRegisteredHash() public {
        vm.prank(ISSUER);
        registry.registerCredential(VALID_HASH);

        vm.prank(ISSUER);
        registry.revokeCredential(VALID_HASH);

        (bool exists, bool revoked, address issuer, uint256 registeredAt, uint256 revokedAt) =
            registry.getCredentialStatus(VALID_HASH);

        assertTrue(exists, "credential should still exist after revocation");
        assertTrue(revoked, "credential should be marked revoked");
        assertEq(issuer, ISSUER, "issuer should remain the original registrant");
        assertGt(registeredAt, 0, "registeredAt should remain populated");
        assertGt(revokedAt, 0, "revokedAt should be populated");
    }

    function testRevokeRejectsZeroHash() public {
        vm.expectRevert(CredentialRegistry.ZeroCredentialHash.selector);
        registry.revokeCredential(bytes32(0));
    }

    function testRevokeRejectsUnregisteredHash() public {
        vm.prank(ISSUER);
        vm.expectRevert(
            abi.encodeWithSelector(
                CredentialRegistry.CredentialNotRegistered.selector,
                VALID_HASH
            )
        );
        registry.revokeCredential(VALID_HASH);
    }

    function testRevokeRejectsOtherAddress() public {
        vm.prank(ISSUER);
        registry.registerCredential(VALID_HASH);

        vm.prank(OTHER);
        vm.expectRevert(
            abi.encodeWithSelector(
                CredentialRegistry.UnauthorizedRevoker.selector,
                OTHER
            )
        );
        registry.revokeCredential(VALID_HASH);
    }

    function testRevokeRejectsDoubleRevocation() public {
        vm.prank(ISSUER);
        registry.registerCredential(VALID_HASH);

        vm.prank(ISSUER);
        registry.revokeCredential(VALID_HASH);

        vm.prank(ISSUER);
        vm.expectRevert(
            abi.encodeWithSelector(
                CredentialRegistry.CredentialAlreadyRevoked.selector,
                VALID_HASH
            )
        );
        registry.revokeCredential(VALID_HASH);
    }

    function testEmitsCredentialRegisteredEvent() public {
        vm.expectEmit(true, true, false, false);
        emit CredentialRegistered(VALID_HASH, ISSUER, 0);

        vm.prank(ISSUER);
        registry.registerCredential(VALID_HASH);
    }

    function testEmitsCredentialRevokedEvent() public {
        vm.prank(ISSUER);
        registry.registerCredential(VALID_HASH);

        vm.expectEmit(true, true, false, false);
        emit CredentialRevoked(VALID_HASH, ISSUER, 0);

        vm.prank(ISSUER);
        registry.revokeCredential(VALID_HASH);
    }

    function assertTrue(bool condition, string memory message) internal pure {
        require(condition, message);
    }

    function assertFalse(bool condition, string memory message) internal pure {
        require(!condition, message);
    }

    function assertEq(address left, address right, string memory message) internal pure {
        require(left == right, message);
    }

    function assertEq(uint256 left, uint256 right, string memory message) internal pure {
        require(left == right, message);
    }

    function assertGt(uint256 left, uint256 right, string memory message) internal pure {
        require(left > right, message);
    }
}
