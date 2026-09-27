// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {NivPayTestDollar} from "../src/NivPayTestDollar.sol";

contract NivPayTestDollarTest is Test {
    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    NivPayTestDollar internal token;

    function setUp() public {
        token = new NivPayTestDollar();
    }

    function test_metadata_cannotBeMistakenForARealStablecoin() public view {
        assertEq(token.name(), "NivPay Test Dollar");
        assertEq(token.symbol(), "TESTUSD");
        assertEq(token.decimals(), 6);
    }

    function test_mint_isOpenToAnyone() public {
        address stranger = makeAddr("stranger");
        address to = makeAddr("to");
        vm.prank(stranger);
        token.mint(to, 123_456789);
        assertEq(token.balanceOf(to), 123_456789);
        assertEq(token.totalSupply(), 123_456789);
    }

    function test_permit_setsAllowanceFromASignature() public {
        (address owner, uint256 key) = makeAddrAndKey("owner");
        address spender = makeAddr("spender");
        uint256 deadline = block.timestamp + 1 hours;

        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, 500_000000, 0, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);

        token.permit(owner, spender, 500_000000, deadline, v, r, s);
        assertEq(token.allowance(owner, spender), 500_000000);
        assertEq(token.nonces(owner), 1);
    }

    function test_constructor_deploysOnMonadTestnet() public {
        vm.chainId(10143);
        NivPayTestDollar deployed = new NivPayTestDollar();
        assertGt(address(deployed).code.length, 0);
        assertEq(deployed.symbol(), "TESTUSD");
    }

    function test_constructor_refusesMonadMainnet() public {
        vm.chainId(143);
        vm.expectRevert(abi.encodeWithSelector(NivPayTestDollar.NotATestChain.selector, 143));
        new NivPayTestDollar();
    }

    function test_constructor_refusesEthereumMainnet() public {
        vm.chainId(1);
        vm.expectRevert(abi.encodeWithSelector(NivPayTestDollar.NotATestChain.selector, 1));
        new NivPayTestDollar();
    }

    function testFuzz_constructor_refusesEveryOtherChain(uint64 chainId) public {
        vm.assume(chainId != 10143 && chainId != 31337);
        vm.chainId(chainId);
        vm.expectRevert(abi.encodeWithSelector(NivPayTestDollar.NotATestChain.selector, chainId));
        new NivPayTestDollar();
    }
}
