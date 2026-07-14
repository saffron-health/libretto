export type WebsiteCase = {
	name: string;
	task: string;
}

export const WEBSITE_CASES: WebsiteCase[] = [
	{
		name: "craigslist used bikes search",
		task: "Search Craigslist for used bikes in San Francisco. Tell me the title and price of the first relevant listing.",
	},
	{
		name: "apartments.com austin apartment search",
		task: "Search Apartments.com for apartments in Austin under $2,000. Tell me the first listing name, price, and neighborhood.",
	},
	{
		name: "apple newest iphone lookup",
		task: "Find the newest iPhone on Apple.com. Tell me its starting price and available colors.",
	},
	{
		name: "google official playwright docs result",
		task: 'Search Google for "Playwright docs network mocking". Open the official docs result and tell me the page title.',
	},
	{
		name: "youtube playwright tutorial search",
		task: 'Search YouTube for "Playwright tutorial". Tell me the title of the first video result.',
	},
	{
		name: "reddit browser automation thread",
		task: 'Search Reddit for "browser automation". Open one relevant thread and summarize the top comment.',
	},
	{
		name: "amazon wireless mouse search",
		task: 'Search Amazon for "wireless mouse". Tell me the name and price of the first organic result.',
	},
	{
		name: "walmart paper towels search",
		task: 'Search Walmart for "paper towels". Tell me the first product name, price, and whether pickup is available.',
	},
	{
		name: "target coffee maker search",
		task: 'Search Target for "coffee maker". Tell me the first product name, price, and rating.',
	},
	{
		name: "best buy headphones search",
		task: 'Search Best Buy for "noise cancelling headphones". Tell me the first product name and price.',
	},
	{
		name: "airbnb austin next weekend search",
		task: "Search Airbnb for stays in Austin next weekend. Tell me the first listing name and nightly price.",
	},
	{
		name: "booking.com chicago hotel search",
		task: "Search Booking.com for hotels in Chicago next weekend. Tell me the first hotel name, rating, and price.",
	},
	{
		name: "expedia sfo jfk flight search",
		task: "Search Expedia for flights from SFO to JFK next Friday. Tell me the cheapest listed price.",
	},
	{
		name: "doordash nyc pizza search",
		task: "Search DoorDash for pizza near New York City. Tell me the first restaurant name and rating.",
	},
	{
		name: "uber eats sf sushi search",
		task: "Search Uber Eats for sushi near San Francisco. Tell me the first restaurant name and delivery estimate.",
	},
	{
		name: "zillow seattle homes search",
		task: "Search Zillow for homes in Seattle under $800k. Tell me the first listing price and address area.",
	},
	{
		name: "realtor.com denver homes search",
		task: "Search Realtor.com for homes in Denver. Tell me the first listing price and number of bedrooms.",
	},
	{
		name: "yelp brooklyn coffee shops search",
		task: "Search Yelp for coffee shops in Brooklyn. Tell me the first business name, rating, and review count.",
	},
	{
		name: "linkedin public job search",
		task: 'Search LinkedIn for "browser automation engineer". Tell me if public results are visible without signing in.',
	},
	{
		name: "hacker news browser automation search",
		task: 'Search Hacker News for "browser automation". Find one recent thread and tell me its title.',
	},
	{
		name: "github playwright repo stats",
		task: "Open the Playwright GitHub repo. Tell me how many stars it has and what language it mostly uses.",
	},
	{
		name: "npm playwright package lookup",
		task: "Look up the playwright package on npm. Tell me the latest version and weekly downloads.",
	},
	{
		name: "pypi requests package lookup",
		task: "Look up the requests package on PyPI. Tell me the latest version and supported Python versions.",
	},
	{
		name: "mdn array map lookup",
		task: "Find the MDN page for Array.prototype.map(). Tell me what the method returns.",
	},
	{
		name: "wikipedia olympics medal table lookup",
		task: "Open the Wikipedia page for the 2024 Summer Olympics medal table. Tell me the top three countries.",
	},
	{
		name: "books to scrape five star cheapest book",
		task: "Find the cheapest book with a 5-star rating on Books to Scrape. Tell me its title and price.",
	},
	{
		name: "quotes to scrape einstein quote",
		task: "Go through Quotes to Scrape and find the first quote by Albert Einstein. Tell me the quote.",
	},
];
