pragma solidity ^0.4.17;

import "./SetLibrary.sol";

contract ERC20
{
    function totalSupply() public view returns (uint256);
    function balanceOf(address who) public view returns (uint256);
    function transfer(address to, uint256 value) public returns (bool);
    function allowance(address owner, address spender) public view returns (uint256);
    function transferFrom(address from, address to, uint256 value) public returns (bool);
    function approve(address spender, uint256 value) public returns (bool);
}


contract Upgradeable
{
    address _dest;
    function replaceCode(address target) public
    {
        require(msg.sender == EscrowProject(_dest).admin() || EscrowProject(_dest).admin() == 0x0);
        _dest = target;
    }
}

contract Dispatcher is Upgradeable
{
    function Dispatcher() public
    {
        _dest = new EscrowProject();
    }
    
    function() public payable
    {
        bytes4 sig;
        assembly { sig := calldataload(0) }
        var target = _dest;
        
        assembly
        {
            let _target := target
            calldatacopy(0x0, 0x0, calldatasize) 
            let retval := delegatecall(gas, _target, 0x0, calldatasize, 0x0, 0)
            let returnsize := returndatasize
            returndatacopy(0x0, 0x0, returnsize)
            switch retval case 0 {revert(0, 0)} default {return (0, returnsize)}
        }
    }
}

contract EscrowProject is Upgradeable
{
    using SetLibrary for SetLibrary.Set;
    
    ///////////////////////////
    /////// CONTRACT STATE VARIABLES
    
    // Settings
    
    uint256 public adminFeePercentage;
    uint256 public agentFeePercentage;
    uint256 public ratingCancelledOrderFee;
    uint256 public orderTimeoutPeriod;
    
    uint256 public FINE_1;
    uint256 public FINE_2;
    
    uint256 public minimumFinishedSellOrdersToArbitrate;
    uint256 public minimumAverageRatingToArbitrate;
    
    
    // Trading state variables
    
    enum TradeParticipantStatus
    {
        UNFINISHED,
        CANCEL,
        COMPLETE
    }
    enum TradeStatus
    {
        UNFINISHED,
        COMPLETED,
        CANCELED,
        DISPUTE
    }
    struct Trade
    {
        address buyer;
        bool withBuyerProtection;
        address seller;
        address currency; // 0x0000... indicates Ether
        bytes32 productHash;
        uint256 value;
        uint256 rating; // 0 indicates that no rating has been placed yet
        bytes32 reviewTextHash;
        uint256 timestamp;
        TradeParticipantStatus buyerStatus;
        TradeParticipantStatus sellerStatus;
        TradeStatus status;
    }
    
    Trade[] public trades;
    mapping(address => uint256[]) public buyersToTradeIndices;
    mapping(address => uint256[]) public sellersToTradeIndices;
    
    
    // Punishment state variables
    
    mapping(address => uint256) public sellerFineLeftToPay;
    
    
    // Dispute and arbitration state variables
    
    SetLibrary.Set internal tradeIndicesWithDisputeWithoutAgent;
    mapping(uint256 => address) public tradeIndicesToDisputeAgents;
    mapping(address => uint256) public agentAddressToDisputedTradeIndex;
    mapping(address => bool) internal manuallyAllowedArbitrators;
    
    
    // Admin state variables
    
    address public admin;
    
    
    // Statistics state variables
    
    mapping(address => uint256) public sellersToAmountOfFinishedOrders;
    mapping(address => uint256) public agentsToAmountOfArbitratedOrders;
    
    
    // Rating state variables
    
    mapping(address => uint256) public sellersToSumOfRatings;
    mapping(address => uint256) public sellersToAmountOfRatings;
    mapping(address => uint256) public buyersToAmountOfFinishedOrders;
    
    
    // Finance state variables
    
    mapping(address => mapping(address => uint256)) public addressToCurrencyToBalance;
    
    
    
    //////////////////////////////////////////////
    /////// MONEY DEPOSIT AND WITHDRAWAL SYSTEM
    
    function withdraw(address _currency) external
    {
        uint256 amount = addressToCurrencyToBalance[msg.sender][_currency];
        addressToCurrencyToBalance[msg.sender][_currency] = 0;
        if (_currency == 0x0)
        {
            msg.sender.transfer(amount);
        }
        else
        {
            require(ERC20(_currency).transfer(msg.sender, amount));
        }
    }
    function depositEther() external payable
    {
        addressToCurrencyToBalance[msg.sender][0x0] += msg.value;
    }
    
    
    /////////////////////////////////////////
    /////// TRADING SYSTEM
    
    function purchase(address _seller, bytes32 _productHash, address _currency, uint256 _value, bool _withBuyerProtection) external payable
    {
        // Add the deposited ETH to the sender's balance
        addressToCurrencyToBalance[msg.sender][0x0] += msg.value;
        
        address buyer = msg.sender;
        
        // You can't buy from yourself
        require(buyer != _seller);
        
        // If they are paying in Tokens:
        if (_currency != 0x0)
        {
            // If they don't have enough balance...
            if (addressToCurrencyToBalance[buyer][_currency] < _value)
            {
                // Transfer the tokens to this contract
                ERC20 tokenContract = ERC20(_currency);
                require(tokenContract.transferFrom(buyer, this, _value - addressToCurrencyToBalance[buyer][_currency]));
            }
        }
        
        require(addressToCurrencyToBalance[buyer][_currency] >= _value);
        
        addressToCurrencyToBalance[buyer][_currency] -= _value;
        
        uint256 tradeIndex = trades.length;
        trades.push(Trade({
            buyer: msg.sender,
            withBuyerProtection: _withBuyerProtection,
            seller: _seller,
            currency: _currency,
            value: _value,
            rating: 0,
            reviewTextHash: 0x0,
            productHash: _productHash,
            timestamp: now,
            buyerStatus: _withBuyerProtection ? TradeParticipantStatus.UNFINISHED : TradeParticipantStatus.COMPLETE,
            sellerStatus: TradeParticipantStatus.UNFINISHED,
            status: TradeStatus.UNFINISHED
        }));
        
        buyersToTradeIndices[buyer].push(tradeIndex);
        sellersToTradeIndices[_seller].push(tradeIndex);
    }
    
    function setPurchaseParticipantStatus(uint256 _tradeIndex, TradeParticipantStatus _newStatus) external
    {
        require(_tradeIndex < trades.length);
        
        Trade storage trade = trades[_tradeIndex];
        
        require(trade.status == TradeStatus.UNFINISHED);
        
        require(_newStatus == TradeParticipantStatus.CANCEL || _newStatus == TradeParticipantStatus.COMPLETE || _newStatus == TradeParticipantStatus.UNFINISHED);
        
        // If it's the buyer
        if (msg.sender == trade.buyer)
        {
            trade.buyerStatus = _newStatus;
        }
        
        // If it's the seller
        else if (msg.sender == trade.seller)
        {
            trade.sellerStatus = _newStatus;
        }
        
        // If it's neither the buyer nor the seller, cancel
        else
        {
            revert();
        }
        
        // If both the buyer and the seller wish to cancel the order, cancel it
        if (trade.sellerStatus == TradeParticipantStatus.CANCEL &&
            trade.buyerStatus == TradeParticipantStatus.CANCEL)
        {
            _finishOrder(_tradeIndex, TradeStatus.CANCELED);
        }
        
        // If both the buyer and the seller wish to complete the order, complete it
        if (trade.sellerStatus == TradeParticipantStatus.COMPLETE &&
            trade.buyerStatus == TradeParticipantStatus.COMPLETE)
        {
            _finishOrder(_tradeIndex, TradeStatus.COMPLETED);
        }
    }
    
    function _finishOrder(uint256 _tradeIndex, TradeStatus _tradeStatus) internal
    {
        // Finishing an order means it must become either canceled or completed
        require(_tradeStatus == TradeStatus.CANCELED || _tradeStatus == TradeStatus.COMPLETED);
        
        // Make sure the trade they are referring to exists
        require(_tradeIndex < trades.length);
        
        Trade storage trade = trades[_tradeIndex];
        
        uint256 valueAfterFees = trade.value;
        
        // If the trade was disputed, give the agent a fee
        if (trade.status == TradeStatus.DISPUTE)
        {
            address agent = tradeIndicesToDisputeAgents[_tradeIndex];
            uint256 agentFee = trade.value * agentFeePercentage / 100;
            valueAfterFees -= agentFee;
            addressToCurrencyToBalance[agent][trade.currency] += agentFee;
            agentsToAmountOfArbitratedOrders[agent]++;
        }
        
        // Set the new trade status
        trade.status = _tradeStatus;
        
        // Give the admin a fee
        uint256 adminFee = trade.value * adminFeePercentage / 100;
        valueAfterFees -= adminFee;
        addressToCurrencyToBalance[admin][trade.currency] += adminFee;
        
        // If the trade is cancelled, the buyer gets the money
        if (_tradeStatus == TradeStatus.CANCELED)
        {
            addressToCurrencyToBalance[trade.buyer][trade.currency] += valueAfterFees;
        }
        
        // If the trade is completed, the seller gets the money
        else if (_tradeStatus == TradeStatus.COMPLETED)
        {
            addressToCurrencyToBalance[trade.seller][trade.currency] += valueAfterFees;
        }
        else
        {
            revert();
        }
        
        // Statistics
        sellersToAmountOfFinishedOrders[trade.seller]++;
        buyersToAmountOfFinishedOrders[trade.buyer]++;
    }
    
    function totalAmountOfTrades() external view returns (uint256)
    {
        return trades.length-1;
    }
    
    function amountOfTradesAsBuyer(address _buyer) public view returns (uint256)
    {
        return buyersToTradeIndices[_buyer].length;
    }
    
    function amountOfTradesAsSeller(address _seller) public view returns (uint256)
    {
        return sellersToTradeIndices[_seller].length;
    }
    
    
    /////////////////////////////////////////
    /////// DISPUTE AND ARBITRATION SYSTEM
    
    function launchDispute(uint256 _tradeIndex) external
    {
        require(_tradeIndex < trades.length);
        
        Trade storage trade = trades[_tradeIndex];
        
        require(trade.status == TradeStatus.UNFINISHED);
        
        // Only the buyer or the seller can launch a dispute on their trade
        require(msg.sender == trade.buyer || msg.sender == trade.seller);
        
        // Only allow the buyer to launch a dispute if they purchased buyer protection
        if (msg.sender == trade.buyer)
        {
            require(trade.withBuyerProtection);
        }
        
        // Dispute is allowed when the buyer and seller disagree.
        // Specifically, that means:
        // Dispute is allowed when the seller wants to cancel and the buyer
        // wants to complete, or vica versa.
        require
        (
            (
                trade.buyerStatus == TradeParticipantStatus.COMPLETE
                &&
                trade.sellerStatus == TradeParticipantStatus.CANCEL
            )
            ||
            (
                trade.buyerStatus == TradeParticipantStatus.CANCEL
                &&
                trade.sellerStatus == TradeParticipantStatus.COMPLETE
            )
        );
        
        trade.status = TradeStatus.DISPUTE;
        
        tradeIndicesWithDisputeWithoutAgent.add(_tradeIndex);
    }
    
    function becomeAgent() external
    {
        // Make sure there are disputes available
        require(areThereDisputesWithoutAgent());
        
        // Make sure the caller is allowed to arbitrate
        require(addressAllowedToArbitrate(msg.sender));
        
        // Make sure the caller isn't already arbitrating
        require(agentAddressToDisputedTradeIndex[msg.sender] == 0);
        
        // Select a random disputed trade that doesn't have an agent yet
        uint256 amountToChooseFrom = tradeIndicesWithDisputeWithoutAgent.size();
        bytes32 randomness = block.blockhash(block.number-1);
        uint256 randomIndex = uint256(randomness) % amountToChooseFrom;
        uint256 tradeIndex = tradeIndicesWithDisputeWithoutAgent.values[randomIndex];
        
        // The buyer and seller of a trade cannot arbitrate their own trade
        require(trades[tradeIndex].buyer != msg.sender);
        require(trades[tradeIndex].seller != msg.sender);
        
        // Set the caller as agent for this trade
        tradeIndicesWithDisputeWithoutAgent.remove(tradeIndex);
        tradeIndicesToDisputeAgents[tradeIndex] = msg.sender;
        agentAddressToDisputedTradeIndex[msg.sender] = tradeIndex;
    }
    
    function resolveDispute(uint256 _tradeIndex, TradeStatus _newStatus) external
    {
        require(msg.sender == tradeIndicesToDisputeAgents[_tradeIndex]);
        
        require(agentAddressToDisputedTradeIndex[msg.sender] == _tradeIndex);
        
        require(_newStatus == TradeStatus.CANCELED || _newStatus == TradeStatus.COMPLETED);
        
        _finishOrder(_tradeIndex, _newStatus);
        
        agentAddressToDisputedTradeIndex[msg.sender] = 0;
    }
    
    function orderTimeout(uint256 _tradeIndex) external
    {
        // The seller may mark an order complete if the timeout period has
        // passed and the buyer has not marked the trade as complete or cancel yet.
        require(msg.sender == trades[_tradeIndex].seller);
        require(trades[_tradeIndex].status == TradeStatus.UNFINISHED);
        require(trades[_tradeIndex].buyerStatus == TradeParticipantStatus.UNFINISHED);
        require(trades[_tradeIndex].timestamp + orderTimeoutPeriod < now);
        _finishOrder(_tradeIndex, TradeStatus.COMPLETED);
    }
    
    function addressAllowedToArbitrate(address _agent) public view returns (bool)
    {
        if (manuallyAllowedArbitrators[_agent]) return true;
        if (sellersToAmountOfFinishedOrders[_agent] >= minimumFinishedSellOrdersToArbitrate &&
            sellerAverageRating(_agent) >= minimumAverageRatingToArbitrate)
        {
            return true;
        }
        return false;
    }
    
    function areThereDisputesWithoutAgent() public view returns (bool)
    {
        return tradeIndicesWithDisputeWithoutAgent.size() > 0;
    }
    
    
    ///////////////////////////
    /////// RATING SYSTEM
    
    function sellerAverageRating(address _seller) public view returns (uint256)
    {
        if (sellersToAmountOfRatings[_seller] == 0)
        {
            return 0;
        }
        else
        {
            return sellersToSumOfRatings[_seller] / sellersToAmountOfRatings[_seller];
        }
    }
    
    function placeRating(uint256 _tradeIndex, uint256 _rating, bytes32 _reviewTextHash) external payable
    {
        // The rating must be from 1 to 100
        require(_rating >= 1 && _rating <= 100);
        
        // Make sure the trade they are referring to exists
        require(_tradeIndex < trades.length);
        
        Trade storage trade = trades[_tradeIndex];
        
        // Only allow rating if the trade is completed or cancelled
        require(trade.status == TradeStatus.COMPLETED ||
                trade.status == TradeStatus.CANCELED);
        
        // If the trade is canceled, require payment of a fee
        if (trade.status == TradeStatus.CANCELED)
        {
            require(msg.value == ratingCancelledOrderFee);
            addressToCurrencyToBalance[admin][0x0] += msg.value;
        }
        else
        {
            require(msg.value == 0);
        }
        
        
        // Only allow the buyer of the trade to rate the seller
        require(trade.buyer == msg.sender);
        
        // Make sure the buyer hasn't already placed a rating
        require(trade.rating == 0);
        
        // Store the rating
        trade.rating = _rating;
        trade.reviewTextHash = _reviewTextHash;
        sellersToSumOfRatings[trade.seller] += _rating;
        sellersToAmountOfRatings[trade.seller]++;
        
        _checkSellerRating(trade.seller);
    }
    
    ///////////////////////////
    /////// PUNISHMENT SYSTEM
    
    function _checkSellerRating(address _seller) internal
    {
        if (sellersToAmountOfFinishedOrders[_seller] == 100)
        {
            if (sellerAverageRating(_seller) < 33)
            {
                // Charge the first level fine
                sellerFineLeftToPay[_seller] += FINE_1;
            }
        }
        else if (sellersToAmountOfFinishedOrders[_seller] == 200)
        {
            if (sellerAverageRating(_seller) < 50)
            {
                // Charge the second level fine
                sellerFineLeftToPay[_seller] += FINE_2;
            }
        }
        else if (sellersToAmountOfFinishedOrders[_seller] == 300)
        {
            if (sellerAverageRating(_seller) < 50)
            {
                // Ban the seller
                sellerFineLeftToPay[_seller] = ~uint256(0);
            }
        }
    }
    
    function payFine() payable external
    {
        require(msg.value <= sellerFineLeftToPay[msg.sender]);
        
        sellerFineLeftToPay[msg.sender] -= msg.value;
        
        addressToCurrencyToBalance[admin][0x0] += msg.value;
    }
    
    
    ///////////////////////////
    /////// ADMIN FUNCTIONS
    
    function setAdmin(address _newAdmin) external
    {
        require(msg.sender == admin);
        require(_newAdmin != 0x0);
        admin = _newAdmin;
    }
    
    function allowAddressToArbitrate(address _agent) external
    {
        require(msg.sender == admin);
        manuallyAllowedArbitrators[_agent] = true;
    }
    
    function removeAllowedAddressToArbitrate(address _agent) external
    {
        require(msg.sender == admin);
        manuallyAllowedArbitrators[_agent] = false;
    }
    
    function initialize() public
    {
        require(admin == 0x0);
        
        admin = msg.sender;
        trades.length++;
        
        adminFeePercentage = 10;
        agentFeePercentage = 2;
        ratingCancelledOrderFee = 0.1 ether;
        orderTimeoutPeriod = 11 days;
        
        FINE_1 = 0.3 ether;
        FINE_2 = 0.4 ether;
        
        minimumFinishedSellOrdersToArbitrate = 50;
        minimumAverageRatingToArbitrate = 80;
    }
}
