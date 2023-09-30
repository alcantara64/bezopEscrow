<?php
////////////////////////
//// SETTINGS

$CONTRACT_ADDRESS = "0x0d4c30532314fca7635c7cebc54080f1990a5650 ";
$CURRENCIES = array(
	"0x0000000000000000000000000000000000000000" => "ETH",
	"0x253b90f42684f0d56dacf6ea9dcd3982f73e834e" => "TEST"
);
$MYSQL_SERVER = "localhost";
$MYSQL_USER = "root";
$MYSQL_PASS = "";
$MYSQL_DATABASE = "escrow_dev";

//// END OF SETTINGS
/////////////////////////


// Connect to the database
$conn = new PDO("mysql:host=".$MYSQL_SERVER, $MYSQL_USER, $MYSQL_PASS);

// Wrapper function to execute queries more easily.
// It will halt execution when a query errors.
function query($q, $arguments=array())
{

	global $conn;
	$q = $conn->prepare($q);
	$q->execute($arguments);
	if ($conn->error = "") die("<hr/><code>MySQL error in query:<br/><br/>$q<br/><br/>".$conn->error."<br/></code>");
	return $q;
}

// Automatic database setup
$conn->query("CREATE DATABASE IF NOT EXISTS ".$MYSQL_DATABASE);
$conn->query("USE ".$MYSQL_DATABASE);

query("CREATE TABLE IF NOT EXISTS products_for_sale (
	id int not null auto_increment,
	seller char(42) not null,
	name text not null,
	description text not null,
	price_currency char(42) not null,
	price_amount varchar(32) not null,
	sha256_hash char(64) not null,
	primary key(id)
)");

query("CREATE TABLE IF NOT EXISTS reviews (
	id int not null auto_increment,
	seller char(42) not null,
	buyer char(42) not null,
	trade_index int not null,
	rating int not null,
	review_text text not null,
	primary key(id)
)");

// Allow clients to supply a product hash, and get the product name back:
// index.php?get_product_name_by_hash=9734713ag89753agf5474ag
if (isset($_GET["get_product_name_by_hash"]))
{
	// Remove a preceding 0x
	if ($_GET["get_product_name_by_hash"][1] === 'x')
	{
		$_GET["get_product_name_by_hash"] = substr($_GET["get_product_name_by_hash"], 2);
	}
	$result = query("SELECT name FROM products_for_sale WHERE sha256_hash=:sha256_hash", array(":sha256_hash" => $_GET["get_product_name_by_hash"]))->fetch();
	if (count($result) == 0) echo "Unknown";
	elseif ($result == false) echo "Unknown";
	else echo $result["name"];
	exit;
}

// Allow clients to fetch all reviews of a seller
if (isset($_GET["getReviewsOf"]))
{
	$reviews = query("SELECT * FROM reviews WHERE seller = :seller", array(":seller" => $_GET["getReviewsOf"]));
	$i = 0;
	foreach ($reviews as $review)
	{
		$i++;
		?>
		<div class="review">
			<div><?=$review["buyer"]?></div>
			<div><?=$review["rating"]?>%</div>
			<div><?=$review["review_text"]?></div>
		</div>
		<?php
	}
	if ($i == 0)
	{
		echo "No reviews available.";
	}
	exit;
}

if (isset($_POST["action"]))
{
	// Allow clients to add a product to the store
	if ($_POST["action"] === "add_product")
	{
		$sha256_hash = hash("sha256", $_POST["name"].$_POST["description"].$_POST["price_currency"].$_POST["price_amount"]);
		query(
			"INSERT INTO products_for_sale (seller, name, description, price_currency, price_amount, sha256_hash) VALUES(:seller, :name, :description, :price_currency, :price_amount, :sha256_hash)",
			array(
				":seller" => $_POST["seller"],
				":name" => $_POST["name"],
				":description" => $_POST["description"],
				":price_currency" => $_POST["currency"],
				":price_amount" => $_POST["price"],
				":sha256_hash" => $sha256_hash)
		);
		header("Location: index.php");
		exit;
	}

	// Allow clients to review a seller
	if ($_POST["action"] === "postReview")
	{
		$sha256_hash = hash("sha256", $_POST["name"].$_POST["description"].$_POST["price_currency"].$_POST["price_amount"]);
		query(
			"INSERT INTO reviews (seller, buyer, trade_index, rating, review_text) VALUES(:seller, :buyer, :trade_index, :rating, :review_text)",
			array(
				":seller" => $_POST["seller"],
				":buyer" => $_POST["buyer"],
				":trade_index" => (int)$_POST["tradeIndex"],
				":rating" => (int)$_POST["rating"],
				":review_text" => $_POST["text"]
			)
		);
		header("Location: index.php");
		exit;
	}
}
?>
<!DOCTYPE html>
<html>
<head>
<link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
<nav>
	<a href="#" onclick="showPage(0);return false;">Marketplace</a>
	<a href="#" onclick="showPage(1);return false;">Your orders <span id="textOrdersInProgressCount"></a></a>
	<a href="#" onclick="showPage(3);return false;">Your money</a>
	<a href="#" onclick="showPage(2);return false;">Arbitrate</a>
</nav>

<!-- Import the contract ABI's -->
<script src="abi.js"></script>

<!-- Import the web3.js library to allow communication with smart contracts -->
<script src="web3.js"></script>

<script>
/* JavaScript global constants */
var ALL_REVIEWED_TRADE_IDS = {<?php
$ids = query("SELECT trade_index FROM reviews");
foreach ($ids as $id)
{
	echo $id["trade_index"].": true, ";
}
?>
"": true};
var CONTRACT_ADDRESS = "<?=$CONTRACT_ADDRESS?>";
var CURRENCIES = {
	<?php
	foreach ($CURRENCIES as $contractAddress => $symbol)
	{
		echo "'$contractAddress': '$symbol',";
	}
	?>
};
</script>
<script src="main.js"></script>
<div id="sellerPage" style="display: none">
	<h2>Seller</h2>
	<table>
		<tbody>
			<tr><td>Address</td><td id="sellerPageAddress"></td></tr>
			<tr><td>Average rating</td><td id="sellerPageAverageRating"></td></tr>
			<tr><td>Amount of ratings</td><td id="sellerPageAmountOfRatings"></td></tr>
			<tr><td>Amount of finished orders</td><td id="sellerPageAmountOfFinishedOrders"></td></tr>
		</tbody>
	</table><br/>
	<h3>Reviews:</h3><br/>
	<div id="sellerPageReviews">

	</div>
</div>
<div id="placeReviewPage" style="display: none;">
	<h2>Place a review</h2>
	<form action="index.php" method="POST" id="reviewForm">
		<input type="hidden" name="action" value="postReview"/>
		<input type="hidden" name="tradeIndex" id="tradeIndexToReview"/>
		<input type="hidden" name="seller" id="sellerToReview"/>
		<input type="hidden" name="buyer" id="buyerToReview"/>
		<table>
			<tr><td>Regarding purchase of:</td><td id="productNameToReview"></td></tr>
			<tr><td>Seller:</td><td id="sellerToReview2"></td></tr>
			<tr><td>Date of purchase:</td><td id="dateOfPurchaseToReview"></td></tr>
			<tr><td>Rating:</td><td>
			<select name="rating" id="reviewRating">
				<option value="1">0%</option>
				<option value="25">25%</option>
				<option value="50">50%</option>
				<option value="75">75%</option>
				<option value="100" selected>100%</option>
			</select></td></tr>
			<tr><td colspan="2">Review text (optional):<br/><textarea id="reviewTextField" name="text" style="width: 300px;height: 150px;"></textarea></td></tr>
		</table>
		<input type="button" value="Place review" onclick="submitReview();"/>
	</form>
</div>
<div id="balancesPage" style="display: none;">
	<h2>Your money</h2>
	<table id="balancesTable">
	</table>
</div>
<div id="yourOrdersPage" style="display: none;">
	<h2>Your orders</h2>
	<table>
		<thead>
			<tr>
				<th></th>
				<th>Product</th>
				<th>Your status</th>
				<th>Counterparty</th>
				<th>Their status</th>
				<th>Trade status</th>
				<th>Amount</th>
			</tr>
		</thead>
		<tbody id="ordersTable">
		</tbody>
	</table>
</div>
<div id="arbitratePage" style="display: none;">
	<h2>Arbitrate</h2>
	<div id="labelNoDisputesAvailable" style="display: none;">
		There are currently no disputes available for arbitration.
	</div>
	<input type="button" value="Arbitrate a dispute" id="btnArbitrate" style="display: none;" onclick="arbitrate();return false;"/>
	<div id="currentArbitration" style="display: none;">

	</div>
</div>
<div id="productsPage">
	<h2>Products for sale</h2>
	<div id="productsForSale">
	<script>
	window.productIdsToSellers = {};
	</script>
	<?php
	/* Display all the products */
	$products = query("SELECT * FROM products_for_sale");
	foreach ($products as $product)
	{
		?>
		<div>
			<div class="productName"><?=$product["name"]?></div>
			<div class="productLabelSeller">Seller:</div>
			<div class="productSellerRating" id="rating<?=$product["id"]?>"></div>
			<div class="productSellerAddress"><a href="#" onclick="sellerPage('<?=$product["seller"]?>');return false;"><?=$product["seller"]?></a></div>
			<div class="productPrice">
				<div><?=$product["price_amount"]?></div>
				<div><?=$CURRENCIES[$product["price_currency"]]?></div>
			</div>
			<div class="productDescription"><?=$product["description"]?></div>
			<div class="productHash"><?=$product["sha256_hash"]?></div>
			<input type="button" id="buyButton<?=$product["id"]?>" onclick="buyProduct('<?=$product["seller"]?>', '0x<?=$product["sha256_hash"]?>', '<?=$product["price_currency"]?>', '<?=$product["price_amount"]?>');" value="Buy now" style="display: none;"/>
			<script>
			window.productIdsToSellers[<?=$product["id"]?>] = "<?=$product["seller"]?>";
			</script>
		</div>
		<?php
	}
	?>
	</div>

	<h2>Add a new product</h2>
	<form action="index.php" method="POST" class="addNewProductForm">
		<input type="hidden" name="action" value="add_product"/>
		<input type="hidden" name="seller" id="sellerAddress"/>
		<table>
			<tr><td>Name:</td><td><input type="text" name="name"/></td></tr>
			<tr><td>Price:</td><td><input type="text" maxlength="32" name="price"/>
				<select name="currency">
					<?php
					foreach ($CURRENCIES as $contractAddress => $symbol)
					{
						?><option value="<?=$contractAddress?>"><?=$symbol?></option><?php
					}
					?>
				</select>
			</td></tr>
			<tr><td colspan="2">Description:<br/><textarea name="description" style="width: 300px;height:100px;"></textarea></td></tr>
		</table>
		<input type="submit" value="Add" id="addProductSubmitButton" style="display: none;"/>
	</form>
</div>
</body>
</html>
