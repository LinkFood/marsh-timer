import type { Species } from "./types";

const duckFacts: Record<string, string[]> = {
  "Alabama": [
    "The Mobile-Tensaw Delta is one of the most productive waterfowl areas in the Southeast.",
    "Alabama's Black Belt region attracts large flights of mallards and wood ducks.",
    "Wheeler National Wildlife Refuge hosts thousands of wintering ducks annually."
  ],
  "Alaska": [
    "Alaska produces more ducks than any other state — over 12 million annually.",
    "The Yukon-Kuskokwim Delta is the largest wetland complex in North America.",
    "Emperor geese and spectacled eiders are unique species found in Alaska's flyways."
  ],
  "Arizona": [
    "The Lower Colorado River and Gila River valleys are Arizona's top waterfowl hunting corridors.",
    "Cibola NWR on the Arizona-California border hosts large concentrations of wintering pintails and wigeon.",
    "Arizona's desert reservoirs and stock tanks attract surprising numbers of teal, shovelers, and ring-necked ducks."
  ],
  "Arkansas": [
    "Stuttgart, AR is known as the 'Duck Hunting Capital of the World.'",
    "The flooded timber of Bayou Meto WMA offers legendary mallard hunting.",
    "The Grand Prairie region of Arkansas draws massive flights from the Mississippi Flyway."
  ],
  "California": [
    "The Sacramento Valley is the winter home to millions of Pacific Flyway ducks.",
    "Sacramento NWR Complex is one of the most visited refuges in the nation for waterfowl.",
    "California's rice fields provide critical habitat for pintails, teal, and widgeon."
  ],
  "Colorado": [
    "The South Platte River corridor is a major migration staging area.",
    "Colorado's eastern plains host significant flights of mallards and teal.",
    "High altitude reservoirs offer unique late-season diving duck opportunities."
  ],
  "Connecticut": [
    "The Connecticut River estuary is the largest tidal wetland complex in New England.",
    "Long Island Sound's coastal marshes attract significant flights of black ducks, bufflehead, and mergansers.",
    "The Great Meadows along the Connecticut River provide important staging habitat for wood ducks and teal."
  ],
  "Delaware": [
    "Bombay Hook NWR on Delaware Bay is one of the premier waterfowl hunting destinations on the East Coast.",
    "Despite being the second-smallest state, Delaware's coastal marshes support massive concentrations of wintering waterfowl.",
    "The Delaware Bay shoreline is a critical Atlantic Flyway corridor for black ducks, pintails, and diving ducks."
  ],
  "Florida": [
    "Florida's mottled duck is a unique non-migratory species found year-round.",
    "Lake Okeechobee and the St. Johns River are premier waterfowl destinations.",
    "Florida is a key wintering ground for blue-winged and green-winged teal."
  ],
  "Georgia": [
    "The Altamaha River delta is Georgia's top waterfowl hunting destination.",
    "Georgia's coastal marshes attract significant numbers of wintering teal and pintails.",
    "Rum Creek WMA offers managed duck hunting opportunities in central Georgia."
  ],
  "Hawaii": [
    "The endangered koloa maoli (Hawaiian duck) is the only endemic duck species in Hawaii and is fully protected from hunting.",
    "Hawaii's waterfowl hunting is limited to migratory species like northern pintails and shovelers that winter on the islands.",
    "The wetlands of Kauai and the North Shore of Oahu provide the best waterfowl habitat in the Hawaiian Islands."
  ],
  "Idaho": [
    "The Snake River Plain hosts massive concentrations of mallards and wigeon.",
    "Market Lake WMA is one of Idaho's most popular public hunting areas.",
    "Idaho's mix of marsh, river, and reservoir habitat supports diverse species."
  ],
  "Illinois": [
    "The Illinois River valley is one of the most important waterfowl corridors in North America.",
    "Chautauqua NWR regularly hosts over 500,000 ducks during peak migration.",
    "Illinois is a critical staging area for canvasbacks, mallards, and diving ducks."
  ],
  "Indiana": [
    "Hovey Lake FWA along the Ohio River is Indiana's premier duck hunting spot.",
    "The Wabash River bottoms provide excellent flooded timber hunting.",
    "Indiana hosts strong flights of wood ducks, mallards, and teal each fall."
  ],
  "Iowa": [
    "Iowa's prairie potholes produce more ducks per acre than almost anywhere in the lower 48.",
    "The Missouri River corridor provides critical migration habitat.",
    "Riverton WMA and Forney Lake are top public hunting destinations."
  ],
  "Kansas": [
    "Cheyenne Bottoms is one of the most important shorebird and waterfowl wetlands in the Western Hemisphere.",
    "Quivira NWR hosts over 500,000 ducks during fall migration.",
    "Kansas sits at the crossroads of the Central Flyway with diverse species."
  ],
  "Kentucky": [
    "Ballard WMA's managed units offer some of the best public duck hunting east of the Mississippi.",
    "Sloughs of the Ohio and Mississippi Rivers hold large concentrations of mallards.",
    "Kentucky Lake and Lake Barkley attract significant numbers of diving ducks."
  ],
  "Louisiana": [
    "Louisiana winters more ducks than any other state in the Mississippi Flyway.",
    "The coastal marshes south of I-10 are the epicenter of Gulf Coast duck hunting.",
    "Pintails, gadwall, and teal dominate Louisiana's harvest each year."
  ],
  "Maine": [
    "Merrymeeting Bay is one of the most significant tidal waterfowl staging areas in the Northeast.",
    "Maine's rugged coastline supports excellent sea duck hunting for eiders, scoters, and long-tailed ducks.",
    "The Scarborough Marsh and Weskeag Marsh are premier public-access waterfowl hunting spots in southern Maine."
  ],
  "Maryland": [
    "The Chesapeake Bay is the Atlantic Flyway's most important wintering area for canvasbacks.",
    "Blackwater NWR on the Eastern Shore provides world-class waterfowl hunting.",
    "Maryland's layout boat hunting for diving ducks is a regional tradition."
  ],
  "Massachusetts": [
    "The Parker River NWR on Plum Island is one of the most popular waterfowl hunting areas in New England.",
    "Cape Cod and the Islands support strong populations of sea ducks including eiders and scoters.",
    "The Great Marshes of Barnstable provide exceptional black duck and teal hunting along the Atlantic Flyway."
  ],
  "Michigan": [
    "Saginaw Bay is Michigan's #1 waterfowl hunting destination.",
    "Michigan's Upper Peninsula offers remote, pressure-free duck hunting.",
    "The state produces strong local flights of wood ducks and blue-winged teal."
  ],
  "Minnesota": [
    "Minnesota is the top duck-producing state in the lower 48.",
    "The prairie pothole region in western MN is the continent's 'duck factory.'",
    "Thief Lake WMA and Lac qui Parle are legendary Minnesota hunting areas."
  ],
  "Mississippi": [
    "The Mississippi Delta's flooded agriculture provides ideal mallard habitat.",
    "Noxubee NWR and Yazoo NWR are premier public waterfowl areas.",
    "The Batture lands along the Mississippi River hold massive late-season flights."
  ],
  "Missouri": [
    "Missouri's 'Grand Pass' region is one of the most storied duck hunting areas in America.",
    "Duck Creek Conservation Area offers managed hunts with excellent success rates.",
    "The confluence of the Missouri and Mississippi Rivers creates a major migration bottleneck."
  ],
  "Montana": [
    "Freezout Lake hosts one of North America's largest tundra swan and snow goose staging areas.",
    "Montana's eastern prairies produce significant numbers of mallards and pintails.",
    "The Missouri River breaks provide remote and productive hunting opportunities."
  ],
  "Nebraska": [
    "The Rainwater Basin is a critical spring and fall staging area for millions of waterfowl.",
    "The Platte River corridor is one of the Central Flyway's most important habitats.",
    "Nebraska's sandhill lakes provide unique late-season diving duck opportunities."
  ],
  "New Hampshire": [
    "Great Bay estuary is New Hampshire's premier waterfowl hunting destination and a critical Atlantic Flyway stopover.",
    "Lake Umbagog NWR on the Maine border provides excellent wood duck and black duck hunting in remote northern habitat.",
    "The seacoast's tidal marshes around Hampton and Rye attract strong flights of black ducks, bufflehead, and mergansers."
  ],
  "New Jersey": [
    "The Edwin B. Forsythe NWR (Brigantine) is one of the most important Atlantic Flyway waterfowl refuges.",
    "New Jersey's Delaware Bay marshes host massive concentrations of black ducks, the highest densities on the East Coast.",
    "The Meadowlands and Great Swamp provide surprisingly productive waterfowl hunting within sight of the NYC skyline."
  ],
  "New Mexico": [
    "Bosque del Apache NWR along the Rio Grande hosts one of the most spectacular waterfowl concentrations in the Southwest.",
    "The Pecos River valley and playa lakes of eastern New Mexico are key Central Flyway staging areas for teal and pintails.",
    "New Mexico's high-desert reservoirs attract significant numbers of diving ducks including redheads and canvasbacks."
  ],
  "Nevada": [
    "Stillwater NWR near Fallon is one of the most important wetlands in the Great Basin.",
    "Ruby Lake NWR provides excellent hunting in Nevada's remote interior.",
    "The Lahontan Valley marshes host significant populations of redheads and canvasbacks."
  ],
  "New York": [
    "Long Island's Great South Bay is famous for sea duck hunting.",
    "The Finger Lakes region attracts large numbers of migrating diving ducks.",
    "Montezuma NWR is a premier stopover for Atlantic Flyway waterfowl."
  ],
  "North Carolina": [
    "The Outer Banks and Pamlico Sound are historic waterfowl hunting grounds.",
    "Mattamuskeet NWR hosts one of the largest concentrations of tundra swans on the East Coast.",
    "North Carolina's coastal marshes attract significant flights of teal and pintails."
  ],
  "North Dakota": [
    "North Dakota is the #1 duck-producing state in the U.S.",
    "Devils Lake and the prairie potholes are legendary waterfowl destinations.",
    "Over 2.5 million ducks are produced in ND each year."
  ],
  "Ohio": [
    "Lake Erie's marshes, especially Ottawa NWR, are Ohio's top waterfowl areas.",
    "Mosquito Creek and Killbuck Marsh attract strong flights of puddle ducks.",
    "Ohio sits at a critical junction of the Mississippi and Atlantic flyways."
  ],
  "Pennsylvania": [
    "Pymatuning Reservoir on the Ohio border is Pennsylvania's top waterfowl destination with massive fall flights of diving ducks.",
    "The Middle Creek WMA in Lebanon County hosts tens of thousands of snow geese and tundra swans each spring.",
    "Presque Isle State Park on Lake Erie provides excellent late-season hunting for canvasbacks, redheads, and scaup."
  ],
  "Oklahoma": [
    "Salt Plains NWR is a major Central Flyway staging area.",
    "Oklahoma's western playas attract significant numbers of green-winged teal.",
    "The Great Salt Plains host some of the highest waterfowl concentrations in the state."
  ],
  "Oregon": [
    "The Klamath Basin hosts one of the largest concentrations of waterfowl in North America.",
    "Summer Lake and Malheur NWR are premier Pacific Flyway hunting destinations.",
    "Oregon's Willamette Valley provides excellent hunting for pintails and wigeon."
  ],
  "Rhode Island": [
    "Narragansett Bay and the coastal salt ponds provide excellent sea duck and black duck hunting.",
    "The Great Swamp Management Area in South Kingstown is Rhode Island's top public waterfowl hunting spot.",
    "Rhode Island has one of the latest duck season closing dates in the Atlantic Flyway, extending into early February."
  ],
  "South Carolina": [
    "The ACE Basin is one of the largest undeveloped estuaries on the East Coast.",
    "South Carolina's managed tidal impoundments offer world-class duck hunting.",
    "Santee Delta and the Waccamaw River provide excellent wood duck and teal hunting."
  ],
  "South Dakota": [
    "South Dakota's glacial lakes and prairie potholes produce massive duck flights.",
    "Sand Lake NWR is one of the most important waterfowl staging areas in the Central Flyway.",
    "The James River valley provides excellent hunting for mallards and gadwall."
  ],
  "Tennessee": [
    "Reelfoot Lake is one of the most famous duck hunting destinations in the country.",
    "The Tennessee NWR system provides over 51,000 acres of managed waterfowl habitat.",
    "West Tennessee's flooded timber offers classic Southern duck hunting experiences."
  ],
  "Texas": [
    "The Texas Gulf Coast is the #1 wintering area for redheads in North America.",
    "Anahuac NWR and the rice prairies near El Campo are legendary hunting spots.",
    "Texas leads the nation in total duck harvest most years."
  ],
  "Utah": [
    "Bear River Migratory Bird Refuge is one of the most important wetlands in the West.",
    "The Great Salt Lake marshes host millions of ducks during fall migration.",
    "Utah's cinnamon teal population is one of the highest in the Pacific Flyway."
  ],
  "Vermont": [
    "Lake Champlain's Dead Creek WMA hosts large concentrations of snow geese and provides excellent duck hunting.",
    "The Missisquoi NWR on Lake Champlain is Vermont's premier managed waterfowl hunting area.",
    "Vermont's beaver ponds and mountain streams produce strong local flights of wood ducks and black ducks."
  ],
  "Virginia": [
    "Back Bay NWR offers excellent hunting for Atlantic Flyway waterfowl.",
    "The Chesapeake Bay's Virginia shore is prime habitat for canvasbacks and redheads.",
    "Virginia's coastal marshes attract strong flights of black ducks and wigeon."
  ],
  "Washington": [
    "The Columbia Basin is Washington's top waterfowl production area.",
    "Puget Sound provides excellent sea duck hunting opportunities.",
    "Ridgefield NWR along the Columbia River hosts large concentrations of wintering ducks."
  ],
  "West Virginia": [
    "The Ohio River floodplain and its backwater sloughs are West Virginia's top waterfowl hunting areas.",
    "McClintic WMA near Point Pleasant offers managed duck hunting with flooded impoundments.",
    "West Virginia's mountain reservoirs attract late-season flights of ring-necked ducks, goldeneyes, and buffleheads."
  ],
  "Wisconsin": [
    "Horicon Marsh is the largest freshwater cattail marsh in the United States.",
    "The Mississippi River pools near La Crosse offer excellent diving duck hunting.",
    "Wisconsin's northern forests produce strong flights of wood ducks and ring-necked ducks."
  ],
  "Wyoming": [
    "Ocean Lake and Boysen Reservoir in the Wind River Basin are Wyoming's most productive waterfowl areas.",
    "The North Platte River corridor near Casper attracts large flights of mallards, gadwall, and teal during migration.",
    "Wyoming spans both the Central and Pacific flyways, offering diverse hunting opportunities from prairie potholes to mountain reservoirs."
  ],
};

export const stateFacts: Record<Species, Record<string, string[]>> = {
  duck: duckFacts,
  goose: {},
  deer: {},
  turkey: {},
  dove: {},
};
