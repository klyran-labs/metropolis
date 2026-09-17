// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title AgentPassportNFT
 * @notice Canonical ERC-721 Passport Token for Autonomous Agents on Monad.
 * @dev Bound directly to ERC-6551 Token Bound Accounts (TBAs). Transferring
 *      the NFT transfers full programmatic ownership of the bound smart account.
 */
contract AgentPassportNFT {
    string public constant name = "Circuit Agent Passport";
    string public constant symbol = "AGNT";

    uint256 private _nextTokenId = 1;

    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _tokenApprovals;
    mapping(address => mapping(address => bool)) private _operatorApprovals;

    mapping(uint256 => string) private _tokenUris;
    mapping(uint256 => address) public tokenAgent;
    mapping(address => uint256) public agentToken;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event PassportMinted(uint256 indexed tokenId, address indexed recipient, address indexed agentAddress, string uri);

    error Unauthorized();
    error NonexistentToken();
    error ZeroAddress();
    error AgentAlreadyRegistered();

    function balanceOf(address account) external view returns (uint256) {
        if (account == address(0)) revert ZeroAddress();
        return _balances[account];
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        address tokenOwner = _owners[tokenId];
        if (tokenOwner == address(0)) revert NonexistentToken();
        return tokenOwner;
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        if (_owners[tokenId] == address(0)) revert NonexistentToken();
        return _tokenUris[tokenId];
    }

    function mintPassport(
        address to,
        address agentAddress,
        string calldata uri
    ) external returns (uint256 tokenId) {
        if (to == address(0) || agentAddress == address(0)) revert ZeroAddress();
        if (agentToken[agentAddress] != 0) revert AgentAlreadyRegistered();

        tokenId = _nextTokenId++;
        _owners[tokenId] = to;
        _balances[to] += 1;
        _tokenUris[tokenId] = uri;
        tokenAgent[tokenId] = agentAddress;
        agentToken[agentAddress] = tokenId;

        emit Transfer(address(0), to, tokenId);
        emit PassportMinted(tokenId, to, agentAddress, uri);
    }

    function approve(address to, uint256 tokenId) external {
        address tokenOwner = ownerOf(tokenId);
        if (msg.sender != tokenOwner && !_operatorApprovals[tokenOwner][msg.sender]) revert Unauthorized();
        _tokenApprovals[tokenId] = to;
        emit Approval(tokenOwner, to, tokenId);
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        if (_owners[tokenId] == address(0)) revert NonexistentToken();
        return _tokenApprovals[tokenId];
    }

    function setApprovalForAll(address operator, bool approved) external {
        if (operator == address(0)) revert ZeroAddress();
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address tokenOwner, address operator) external view returns (bool) {
        return _operatorApprovals[tokenOwner][operator];
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        if (to == address(0)) revert ZeroAddress();
        address tokenOwner = ownerOf(tokenId);
        if (from != tokenOwner) revert Unauthorized();

        bool isAllowed = (msg.sender == tokenOwner ||
            _tokenApprovals[tokenId] == msg.sender ||
            _operatorApprovals[tokenOwner][msg.sender]);
        if (!isAllowed) revert Unauthorized();

        delete _tokenApprovals[tokenId];
        _balances[from] -= 1;
        _balances[to] += 1;
        _owners[tokenId] = to;

        emit Transfer(from, to, tokenId);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 || // ERC-165
               interfaceId == 0x80ac58cd || // ERC-721
               interfaceId == 0x5b5e139f;   // ERC-721Metadata
    }
}
