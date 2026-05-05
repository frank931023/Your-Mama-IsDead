// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DigitalTablet} from "../src/DigitalTablet.sol";
import {IERC6150} from "../src/interfaces/IERC6150.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

contract DigitalTabletTest is Test {
    DigitalTablet internal tablet;

    address internal admin = address(0xA11CE);
    address internal minter = address(0xB0B);
    address internal alice = address(0xA1);
    address internal bob = address(0xB2);
    address internal carol = address(0xC3);

    bytes32 internal constant MINTER_ROLE = keccak256("MINTER_ROLE");

    string internal constant ROOT_URI = "ipfs://root";
    string internal constant CHILD_URI = "ipfs://child";
    string internal constant GRAND_URI = "ipfs://grandchild";
    string internal constant ARTIFACT_URI = "ipfs://artifact";

    function setUp() public {
        vm.prank(admin);
        tablet = new DigitalTablet();

        // grant a separate minter so we can distinguish admin vs pure minter
        vm.prank(admin);
        tablet.grantRole(MINTER_ROLE, minter);
    }

    // ─── Deploy + role wiring ───────────────────────────────────────────────
    function test_DeployerHoldsAdminAndMinterRoles() public view {
        assertTrue(tablet.hasRole(tablet.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(tablet.hasRole(MINTER_ROLE, admin));
        assertEq(tablet.name(), "Digital Tablet");
        assertEq(tablet.symbol(), "DTAB");
    }

    function test_GrantedMinterHasMinterRole() public view {
        assertTrue(tablet.hasRole(MINTER_ROLE, minter));
        assertFalse(tablet.hasRole(MINTER_ROLE, alice));
    }

    // ─── mintRoot ───────────────────────────────────────────────────────────
    function test_MintRoot_ByMinter_Succeeds() public {
        vm.prank(minter);
        uint256 id = tablet.mintRoot(alice, ROOT_URI);

        assertEq(id, 1);
        assertEq(tablet.ownerOf(id), alice);
        assertEq(tablet.tokenURI(id), ROOT_URI);
        assertTrue(tablet.isRoot(id));
        assertTrue(tablet.isLeaf(id));
        assertEq(tablet.parentOf(id), 0);
        assertEq(tablet.childrenOf(id).length, 0);
    }

    function test_MintRoot_NonMinter_Reverts() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                MINTER_ROLE
            )
        );
        tablet.mintRoot(alice, ROOT_URI);
    }

    // ─── safeMintWithParent ─────────────────────────────────────────────────
    function test_SafeMintWithParent_Holder_CanMintChild() public {
        vm.prank(minter);
        uint256 root = tablet.mintRoot(alice, ROOT_URI);

        vm.prank(alice);
        uint256 child = tablet.safeMintWithParent(bob, root, CHILD_URI);

        assertEq(tablet.ownerOf(child), bob);
        assertEq(tablet.parentOf(child), root);
        assertFalse(tablet.isRoot(child));
        assertTrue(tablet.isLeaf(child));
        assertFalse(tablet.isLeaf(root));
        assertEq(tablet.childrenOf(root).length, 1);
        assertEq(tablet.childrenOf(root)[0], child);
    }

    function test_SafeMintWithParent_NonHolder_Reverts() public {
        vm.prank(minter);
        uint256 root = tablet.mintRoot(alice, ROOT_URI);

        vm.prank(carol);
        vm.expectRevert(
            abi.encodeWithSelector(
                DigitalTablet.NotParentOwnerOrMinter.selector,
                carol,
                root
            )
        );
        tablet.safeMintWithParent(carol, root, CHILD_URI);
    }

    function test_SafeMintWithParent_MinterRole_BypassOwnership() public {
        vm.prank(minter);
        uint256 root = tablet.mintRoot(alice, ROOT_URI);

        // minter is NOT the owner of root, but holds MINTER_ROLE → allowed
        vm.prank(minter);
        uint256 child = tablet.safeMintWithParent(bob, root, CHILD_URI);

        assertEq(tablet.ownerOf(child), bob);
        assertEq(tablet.parentOf(child), root);
    }

    function test_SafeMintWithParent_NonexistentParent_Reverts() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(DigitalTablet.ParentDoesNotExist.selector, 999)
        );
        tablet.safeMintWithParent(alice, 999, CHILD_URI);
    }

    // ─── ERC-6150 invariants ────────────────────────────────────────────────
    function test_ParentOf_Nonexistent_Reverts() public {
        vm.expectRevert(
            abi.encodeWithSelector(DigitalTablet.TokenDoesNotExist.selector, 42)
        );
        tablet.parentOf(42);
    }

    function test_IsRoot_IsLeaf_NonexistentToken_ReturnsFalse() public view {
        assertFalse(tablet.isRoot(123));
        assertFalse(tablet.isLeaf(123));
    }

    // ─── tokenURI + artifactURI auth ────────────────────────────────────────
    function test_TokenURI_ReturnsStoredURI() public {
        vm.prank(minter);
        uint256 id = tablet.mintRoot(alice, ROOT_URI);
        assertEq(tablet.tokenURI(id), ROOT_URI);
    }

    function test_TokenURI_Nonexistent_Reverts() public {
        vm.expectRevert(
            abi.encodeWithSelector(DigitalTablet.TokenDoesNotExist.selector, 7)
        );
        tablet.tokenURI(7);
    }

    function test_SetArtifactURI_Owner_Succeeds() public {
        vm.prank(minter);
        uint256 id = tablet.mintRoot(alice, ROOT_URI);

        vm.prank(alice);
        tablet.setArtifactURI(id, ARTIFACT_URI);
        assertEq(tablet.artifactURI(id), ARTIFACT_URI);
    }

    function test_SetArtifactURI_Minter_Succeeds() public {
        vm.prank(minter);
        uint256 id = tablet.mintRoot(alice, ROOT_URI);

        vm.prank(minter);
        tablet.setArtifactURI(id, ARTIFACT_URI);
        assertEq(tablet.artifactURI(id), ARTIFACT_URI);
    }

    function test_SetArtifactURI_NonOwnerNonMinter_Reverts() public {
        vm.prank(minter);
        uint256 id = tablet.mintRoot(alice, ROOT_URI);

        vm.prank(carol);
        vm.expectRevert(
            abi.encodeWithSelector(
                DigitalTablet.NotTokenOwnerOrMinter.selector,
                carol,
                id
            )
        );
        tablet.setArtifactURI(id, ARTIFACT_URI);
    }

    function test_SetArtifactURI_Update_Overwrites() public {
        vm.prank(minter);
        uint256 id = tablet.mintRoot(alice, ROOT_URI);

        vm.prank(alice);
        tablet.setArtifactURI(id, "ipfs://v1");
        vm.prank(alice);
        tablet.setArtifactURI(id, "ipfs://v2");

        assertEq(tablet.artifactURI(id), "ipfs://v2");
    }

    // ─── 3-generation tree ──────────────────────────────────────────────────
    function test_ThreeGenerationTree() public {
        // gen 0: root, owned by alice
        vm.prank(minter);
        uint256 root = tablet.mintRoot(alice, ROOT_URI);

        // gen 1: alice mints two children to bob and carol
        vm.prank(alice);
        uint256 child1 = tablet.safeMintWithParent(bob, root, CHILD_URI);
        vm.prank(alice);
        uint256 child2 = tablet.safeMintWithParent(carol, root, CHILD_URI);

        // gen 2: bob mints a grandchild under child1
        vm.prank(bob);
        uint256 grand = tablet.safeMintWithParent(bob, child1, GRAND_URI);

        // structure
        assertTrue(tablet.isRoot(root));
        assertFalse(tablet.isLeaf(root));
        assertEq(tablet.parentOf(child1), root);
        assertEq(tablet.parentOf(child2), root);
        assertEq(tablet.parentOf(grand), child1);

        uint256[] memory rootKids = tablet.childrenOf(root);
        assertEq(rootKids.length, 2);
        assertEq(rootKids[0], child1);
        assertEq(rootKids[1], child2);

        uint256[] memory child1Kids = tablet.childrenOf(child1);
        assertEq(child1Kids.length, 1);
        assertEq(child1Kids[0], grand);

        assertTrue(tablet.isLeaf(child2));
        assertTrue(tablet.isLeaf(grand));
        assertFalse(tablet.isLeaf(child1));

        // sequential ids
        assertEq(root, 1);
        assertEq(child1, 2);
        assertEq(child2, 3);
        assertEq(grand, 4);
    }

    // ─── Events ─────────────────────────────────────────────────────────────
    function test_MintRoot_EmitsMintedEvent() public {
        vm.expectEmit(true, true, true, true);
        emit IERC6150.Minted(minter, address(0), 0, alice, 1);
        vm.prank(minter);
        tablet.mintRoot(alice, ROOT_URI);
    }

    function test_SafeMintWithParent_EmitsMintedEvent() public {
        vm.prank(minter);
        uint256 root = tablet.mintRoot(alice, ROOT_URI);

        vm.expectEmit(true, true, true, true);
        emit IERC6150.Minted(alice, alice, root, bob, 2);
        vm.prank(alice);
        tablet.safeMintWithParent(bob, root, CHILD_URI);
    }

    // ─── Introspection ──────────────────────────────────────────────────────
    function test_SupportsInterface() public view {
        // ERC-165
        assertTrue(tablet.supportsInterface(0x01ffc9a7));
        // ERC-721
        assertTrue(tablet.supportsInterface(0x80ac58cd));
        // ERC-721 Metadata
        assertTrue(tablet.supportsInterface(0x5b5e139f));
        // AccessControl
        assertTrue(tablet.supportsInterface(type(IAccessControl).interfaceId));
        // IERC6150 (custom)
        assertTrue(tablet.supportsInterface(type(IERC6150).interfaceId));
        // unknown
        assertFalse(tablet.supportsInterface(0xdeadbeef));
    }
}
