// This function will perform a HTTP get request.
// It returns a Promise of the response content

function get(url)
{
	return new Promise((resolve, reject)=>{
		var xhttp = new XMLHttpRequest();
		xhttp.onreadystatechange = function() {
			if (this.readyState == 4 && this.status == 200)
			{
				resolve(this.responseText);
			}
			else if (this.readyState == 4)
			{
				reject("AJAX failed with HTTP status "+this.status);
			}
		};
		xhttp.open("GET", url, true);
		xhttp.send();
	});
}

// This variable stores the Ethereum address of the user
var account = null;

//import elements by id
function importById(elementsId){
    return document.getElementById(elementsId);
}



async function init()
{
	try
	{
		// Checking if Web3 has been injected by the browser
		// (Mist, MetaMask or some other plugin or add-on)
		if (typeof web3 !== 'undefined')
		{
			console.log("currentProvider="+window.web3.currentProvider);

			console.log("window.web3.currentProvider.constructor.name="+window.web3.currentProvider.constructor.name);

			// Use Mist/MetaMask's provider
			console.log("The browser has injected web3:");
			console.log(web3.currentProvider);
			window.web3 = new Web3(web3.currentProvider);
		}
		else
		{
			console.log("The browser has not injected web3! Attempting connection to local node...");

			// Fallback strategy
			window.web3 = new Web3(new Web3.providers.HttpProvider("https://ropsten.infura.io/c21j1dMqHrU3uAZGAEbN"));
		}
	}
	catch (e)
	{
		console.log("Not connected because of failure in initializing web3.js:");
		console.log(e);
		initializing = false;
		return;
	}

	var ABIinstance = window.web3.eth.contract(ABI);
	window.ERC20_ABIinstance = window.web3.eth.contract(ABI_ERC20);
	var contractInstance = ABIinstance.at(CONTRACT_ADDRESS);

	// General wrapper function to call contract functions more easily
	window.callContract = async function(funcName)
	{
		var args = arguments;
		return await new Promise((resolve, reject) => {
			var callback = function(err, result){
				if (err != null) { reject(err); return; }
				resolve(result);
			};
			var func = contractInstance[funcName];

			if (args.length == 1) func(callback);
			else if (args.length == 2) func(args[1], callback);
			else if (args.length == 3) func(args[1], args[2], callback);
			else if (args.length == 4) func(args[1], args[2], args[3], callback);
			else if (args.length == 5) func(args[1], args[2], args[3], args[4], callback);
			else if (args.length == 6) func(args[1], args[2], args[3], args[4], args[5], callback);
			else if (args.length == 7) func(args[1], args[2], args[3], args[4], args[5], args[6], callback);
			else throw "Too many args :(";
		});
	}

	// The update function is called every 3 seconds.
	// It updates all page content that is loaded from the smart contracts:
	// the orders list, the arbitration page, the seller ratings, etc..
	async function update()
	{
		account = await new Promise((resolve, reject) => { web3.eth.getAccounts(function(err, accounts){
			if (err != null) resolve(null);
			else if (accounts.length == 0) resolve(null);
			else resolve(accounts[0]);
		})});

		// Set the hidden input in the Add Product form
		importById("sellerAddress").value = account;
                console.log('sss');
		// Load the current amount of trades of the visitor
		var amountOfTradesAsBuyer = parseInt(await callContract("amountOfTradesAsBuyer", account));
		var amountOfTradesAsSeller = parseInt(await callContract("amountOfTradesAsSeller", account));

		var yourOrders = [];
		var yourOrdersAmountAsSeller = 0;
		var yourOrdersAmountAsBuyer = 0;

		var totalOrdersInProgress = 0;

		// Loop over all the visitor's trades.
		// Fetch their details and store them into the yourOrders array
		while (yourOrders.length < amountOfTradesAsBuyer + amountOfTradesAsSeller)
		{
			var tradeIndex;
			if (yourOrdersAmountAsBuyer < amountOfTradesAsBuyer)
			{
				tradeIndex = await callContract("buyersToTradeIndices", account, yourOrdersAmountAsBuyer);
				yourOrdersAmountAsBuyer++;
			}
			else if (yourOrdersAmountAsSeller < amountOfTradesAsSeller)
			{
				tradeIndex = await callContract("sellersToTradeIndices", account, yourOrdersAmountAsSeller);
				yourOrdersAmountAsSeller++;
			}
			else break;

			var trade = await callContract("trades", tradeIndex);
			trade = {
				index: tradeIndex,
				buyer: trade[0],
				withBuyerProtection: trade[1],
				seller: trade[2],
				currency: trade[3],
				productHash: trade[4],
				value: trade[5],
				rating: trade[6],
				reviewTextHash: trade[7],
				timestamp: trade[8],
				buyerStatus: parseInt(trade[9]),
				sellerStatus: parseInt(trade[10]),
				status: parseInt(trade[11]),
				productName: await get("index.php?get_product_name_by_hash="+trade[4])
			};

			if (trade.status == 0 || trade.status == 3) totalOrdersInProgress++;

			yourOrders.push(trade);
		}

		// If the user has unfinished orders, display a counter in the navigation bar.
		if (totalOrdersInProgress == 0) importById("textOrdersInProgressCount").innerHTML = "";
		else importById("textOrdersInProgressCount").innerHTML = "("+totalOrdersInProgress+")";

		// Clear the orders table before appending its current contents
		importById("ordersTable").innerHTML = "";

		// Add all the orders and their details to the orders table
		var i;
		for (i=0; i<yourOrders.length; i++)
		{
			var trade = yourOrders[i];

			var tradeRow = document.createElement("tr");
			function addCell(content)
			{
				var tradeCell = document.createElement("td");
				{
					tradeCell.innerHTML = content;
				}
				tradeRow.appendChild(tradeCell);
			}

			// You are
			addCell(trade.seller == account ? "Selling" : "Buying");

			// Product
			addCell(trade.productName);

			// Your status
			var yourStatus = trade.seller == account ? trade.sellerStatus : trade.buyerStatus;
			if (yourStatus == 0) addCell("Waiting");
			else if (yourStatus == 1) addCell("Cancel");
			else if (yourStatus == 2) addCell("Complete");
			else addCell("error:"+yourStatus);

			// Counterparty
			addCell(trade.seller == account ? trade.buyer : trade.seller);

			// Their status
			var theirStatus = trade.buyer == account ? trade.sellerStatus : trade.buyerStatus;
			if (theirStatus == 0) addCell("Waiting");
			else if (theirStatus == 1) addCell("Cancel");
			else if (theirStatus == 2) addCell("Complete");
			else addCell("error");

			// Trade status
			if (trade.status == 0) addCell("In progress");
			else if (trade.status == 1) addCell("Completed");
			else if (trade.status == 2) addCell("Canceled");
			else if (trade.status == 3) addCell("Disputed");
			else addCell("error");

			// Amount
			addCell(web3.fromWei(trade.value)+" "+CURRENCIES[trade.currency]);

			// Action
			if (trade.status == 0 &&
			   ((theirStatus == 1 && yourStatus == 2) ||
			    (theirStatus == 2 && yourStatus == 1)))
			{
				addCell("<a href='#' onclick='disputeTrade("+trade.index+");return false;'>Dispute</a>");
			}
			else if (trade.status == 0 && yourStatus == 0)
			{
				addCell("<a href='#' onclick='cancelTrade("+trade.index+");return false;'>Cancel</a> <a href='#' onclick='completeTrade("+trade.index+");return false;'>Complete</a>");
			}
			else if (trade.status == 1 && trade.buyer === account && trade.rating == 0 && !ALL_REVIEWED_TRADE_IDS.hasOwnProperty(trade.index))
			{
				addCell("<a href='#' onclick='placeRating("+trade.index+", \""+trade.seller+"\", \""+trade.buyer+"\", \""+trade.productName+"\", "+trade.timestamp+");return false;'>Place review</a>");
			}
			else
			{
				addCell("");
			}

			importById("ordersTable").appendChild(tradeRow);
		}

		if (i == 0) importById("ordersTable").innerHTML = "<tr><td colspan='6'>No orders</td></tr>";

		// Load all the user's balances
		var balances = {};
		for (var currency in CURRENCIES)
		{
			if (!CURRENCIES.hasOwnProperty(currency)) continue;

			var balance = await callContract("addressToCurrencyToBalance", account, currency);

			if (currency == "0x0000000000000000000000000000000000000000")
			{
				balances[currency] = balance;
			}
			else
			{
				balance = balance.add(await new Promise((resolve, reject) => {
					ERC20_ABIinstance.at(currency).allowance(account, CONTRACT_ADDRESS, function(err, result){
						if (err != null) reject(err);
						else resolve(result);
					});
				}));
				balances[currency] = balance;
			}
		}

		// Display all the user's balances
		importById("balancesTable").innerHTML = "";
		for (var currency in balances)
		{
			if (!CURRENCIES.hasOwnProperty(currency)) continue;
			var balanceRow = document.createElement("tr");
			{
				var amountCell = document.createElement("td");
				{
					amountCell.innerHTML = web3.fromWei(balances[currency]);
				}
				balanceRow.appendChild(amountCell);
				var symbolCell = document.createElement("td");
				{
					symbolCell.innerHTML = CURRENCIES[currency];
				}
				balanceRow.appendChild(symbolCell);
				var withdrawCell = document.createElement("td");
				{
					withdrawCell.innerHTML = "<a href='#' onclick='withdraw(\""+currency+"\");return false;'>Withdraw</a>";
				}
				balanceRow.appendChild(withdrawCell);
				var depositCell = document.createElement("td");
				{
					depositCell.innerHTML = "<a href='#' onclick='deposit(\""+currency+"\");return false;'>Deposit</a>";
				}
				balanceRow.appendChild(depositCell);
			}
			importById("balancesTable").appendChild(balanceRow);
		}

		// For each seller, load their rating at display it at each product
		var sellersToRatings = {};
		for (var i in window.productIdsToSellers)
		{
			if (window.productIdsToSellers.hasOwnProperty(i))
			{
				var seller = window.productIdsToSellers[i];
				if (seller === account || account == null)
				{
					importById("buyButton"+i).style.display = "none";
				}
				else
				{
					importById("buyButton"+i).style.display = "inline-block";
				}

				if (!sellersToRatings.hasOwnProperty(seller))
				{
					sellersToRatings[seller] = parseInt(await callContract("sellerAverageRating", seller));
				}
				if (sellersToRatings[seller] == 0) importById("rating"+i).innerHTML = "Unrated";
				else importById("rating"+i).innerHTML = sellersToRatings[seller]+"%";
			}
		}

		// Only display the Add product button if the user has an Ethereum account and is logged in
		if (account === null)
		{
			importById("addProductSubmitButton").style.display = "none";
		}
		else
		{
			importById("addProductSubmitButton").style.display = "inline-block";
		}

		// Update the arbitration page
		var arbitratingTradeIndex = parseInt(await callContract("agentAddressToDisputedTradeIndex", account));
		if (arbitratingTradeIndex == 0)
		{
			var areThereDisputesWithoutAgent = await callContract("areThereDisputesWithoutAgent");
			if (areThereDisputesWithoutAgent)
			{
				importById("btnArbitrate").style.display = "inline-block";
				importById("currentArbitration").style.display = "none";
				importById("labelNoDisputesAvailable").style.display = "none";
			}
			else
			{
				importById("btnArbitrate").style.display = "none";
				importById("currentArbitration").style.display = "none";
				importById("labelNoDisputesAvailable").style.display = "block";
			}
		}
		else
		{
			var trade = await callContract("trades", arbitratingTradeIndex);
			trade = {
				buyer: trade[0],
				withBuyerProtection: trade[1],
				seller: trade[2],
				currency: trade[3],
				productHash: trade[4],
				value: trade[5],
				rating: trade[6],
				timestamp: trade[7],
				buyerStatus: parseInt(trade[8]),
				sellerStatus: parseInt(trade[9]),
				status: parseInt(trade[10]),
				productName: await get("index.php?get_product_name_by_hash="+trade[4])
			};

			importById("btnArbitrate").style.display = "none";
			importById("currentArbitration").style.display = "block";
			importById("labelNoDisputesAvailable").style.display = "none";

			importById("currentArbitration").innerHTML = "You are currently arbitrating this trade:<br/><br/><b>Product:</b> "+trade.productName+"<br/><b>Value:</b> "+web3.fromWei(trade.value)+" "+CURRENCIES[trade.currency]+"<br/><b>Buyer:</b> "+trade.buyer+" (wants to "+(trade.buyerStatus == 1 ? "cancel" : "complete")+")<br/><b>Seller:</b> "+trade.seller+" (wants to "+(trade.sellerStatus == 1 ? "cancel" : "complete")+")<br/><br/><input type='button' value=\"Cancel the trade\" onclick='arbitratorCancel("+arbitratingTradeIndex+");'/><br/><br/><input type='button' value=\"Complete the trade\" onclick='arbitratorComplete("+arbitratingTradeIndex+");'/>";
		}

		// Run update() again in 3 seconds.
		setTimeout(update, 3000);
	}
	update();
}
window.addEventListener("load", function(){
	init();
});

// This function is called when a user clicks the buy button on a product
async function buyProduct(seller, productHash, currency, amount)
{
	var ethToSend = 0;
	if (currency == "0x0" || currency == "0x0000000000000000000000000000000000000000")
	{
		ethToSend = web3.toWei(amount);
	}
	var callbackProduct = parseInt( await callContract("purchase", seller, productHash, currency, web3.toWei(amount), true, {value: ethToSend}));
    return callbackProduct  ;
    
}


function showPage(pageNumber)
{
	importById("productsPage").style.display = "none";
	importById("yourOrdersPage").style.display = "none";
	importById("arbitratePage").style.display = "none";
	importById("balancesPage").style.display = "none";
	importById("placeReviewPage").style.display = "none";
	importById("sellerPage").style.display = "none";

	if (pageNumber == 0) importById("productsPage").style.display = "block";
	if (pageNumber == 1) importById("yourOrdersPage").style.display = "block";
	if (pageNumber == 2) importById("arbitratePage").style.display = "block";
	if (pageNumber == 3) importById("balancesPage").style.display = "block";
	if (pageNumber == 4) importById("placeReviewPage").style.display = "block";
	if (pageNumber == 5) importById("sellerPage").style.display = "block";
}

// These functions are called when their respective buttons are pressed.
// They will call an appropriate smart contract function.
function arbitratorComplete(tradeIndex)
{
	var callBackComplete = parseInt(callContract("resolveDispute", tradeIndex, 1));
	console.log(callBackComplete);
}
function arbitratorCancel(tradeIndex)
{
	callContract("resolveDispute", tradeIndex, 2);
}
function disputeTrade(tradeIndex)
{
	callContract("launchDispute", tradeIndex);
        //launchDispute(tradeIndex);
}
function cancelTrade(tradeIndex)
{
	callContract("setPurchaseParticipantStatus", tradeIndex, 1);
}
function completeTrade(tradeIndex)
{
	callContract("setPurchaseParticipantStatus", tradeIndex, 2);
}
function arbitrate()
{
	callContract("becomeAgent");
}
function withdraw(currency)
{
	callContract("withdraw", currency);
}

function timeConverter(UNIX_timestamp)
{
	var a = new Date(UNIX_timestamp * 1000);
	var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
	var year = a.getFullYear();
	var month = a.getMonth() < 10 ? '0' + a.getMonth() : a.getMonth();
	var date = a.getDate() < 10 ? '0' + a.getDate() : a.getDate();
	var hour = a.getHours();
	var min = a.getMinutes() < 10 ? '0' + a.getMinutes() : a.getMinutes();
	var sec = a.getSeconds();
	var time = year + '-' + month + '-' + date;
	return time;
}

// This function is called if the user clicks the Review link next to an order.
// It will show them the review form.
function placeRating(tradeIndex, seller, buyer, productName, timestamp)
{
	importById("tradeIndexToReview").value = tradeIndex;
	importById("sellerToReview").value = seller;
	importById("buyerToReview").value = buyer;
	importById("sellerToReview2").innerHTML = seller;
	importById("productNameToReview").innerHTML = productName;
	importById("dateOfPurchaseToReview").innerHTML = timeConverter(timestamp);
	showPage(4);
}

// This function is called if the user has finished writing their review,
// and clicks to submit it.
async function submitReview(tradeIndex,rating,text)
{
	try
	{
		console.log("tradeIndexToReview="+parseInt(tradeIndex));
		console.log("tradeIndexToReview="+parseInt(rating));
		console.log("reviewTextField="+web3.sha3(text));
		await callContract("placeRating", parseInt(importById("tradeIndexToReview").value), parseInt(importById("reviewRating").value), web3.sha3(importById("reviewTextField").value));
		importById("reviewForm").submit();
	}
	catch (e)
	{
		console.error(e);
	}
}

async function deposit(currency)
{
	var amount = prompt("How much "+CURRENCIES[currency]+" would you like to deposit?", "");
	if (amount == null) return;
	if (currency == "0" || currency == "0x0" || currency == "0x0000000000000000000000000000000000000000")
	{
		callContract("deposit", {value: web3.toWei(amount)});
	}
	else
	{
		var priorApproval = (await new Promise((resolve, reject) => {
			ERC20_ABIinstance.at(currency).allowance(account, CONTRACT_ADDRESS, function(err, result){
				if (err != null) reject(err);
				else resolve(result);
			});
		}));
		ERC20_ABIinstance.at(currency).approve(CONTRACT_ADDRESS, priorApproval.add(web3.toWei(amount)), function(err, result){
			console.log(err);
			console.log(result);
		});
	}
}

// This function will display a seller page. The 'seller' parameter is an Ethereum address.
// It will load the information about the seller.
async function sellerPage(seller)
{
	showPage(5);
	importById("sellerPageReviews").innerHTML = "";
	importById("sellerPageAverageRating").innerHTML = "";
	importById("sellerPageAmountOfRatings").innerHTML = "";
	importById("sellerPageAmountOfFinishedOrders").innerHTML = "";

	importById("sellerPageAddress").innerHTML = seller;
	var rating = parseInt(await callContract("sellerAverageRating", seller));
	if (rating == 0)
	{
		importById("sellerPageAverageRating").innerHTML = "Unrated";
	}
	else
	{
		importById("sellerPageAverageRating").innerHTML = rating + "%";
	}
	importById("sellerPageAmountOfRatings").innerHTML = await callContract("sellersToAmountOfRatings", seller);
	importById("sellerPageAmountOfFinishedOrders").innerHTML = await callContract("sellersToAmountOfFinishedOrders", seller);

	importById("sellerPageReviews").innerHTML = await get("index.php?getReviewsOf="+seller);
}
