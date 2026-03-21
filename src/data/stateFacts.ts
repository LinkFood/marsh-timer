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

const gooseFacts: Record<string, string[]> = {
  "Alabama": [
    "Wheeler NWR near Decatur is Alabama's top Canada goose wintering area with thousands arriving each November.",
    "Alabama's Tennessee Valley hosts the state's largest concentrations of wintering geese along the Tennessee River.",
    "Snow goose sightings have increased dramatically in Alabama over the past decade as populations push further south."
  ],
  "Alaska": [
    "Alaska's Izembek NWR hosts virtually the entire world population of Pacific black brant during fall staging.",
    "The Yukon-Kuskokwim Delta produces more geese than any other area in North America, including emperor, cackling, and white-fronted geese.",
    "Emperor geese are found almost exclusively in Alaska and are one of the rarest huntable goose species in the world."
  ],
  "Arizona": [
    "The agricultural fields around Gila Bend and Buckeye attract wintering Canada geese and occasional snow geese.",
    "Arizona's portion of the Lower Colorado River provides important habitat for migrating and wintering geese.",
    "Cibola NWR on the Arizona-California border is a key Pacific Flyway stopover for geese heading to Mexico."
  ],
  "Arkansas": [
    "Arkansas lies in the heart of the Mississippi Flyway and hosts large flights of snow, blue, and white-fronted geese.",
    "The rice and soybean fields of the Grand Prairie attract massive concentrations of specklebellies (white-fronted geese).",
    "Bald Knob NWR and the Cache River bottoms provide critical goose habitat in northeastern Arkansas."
  ],
  "California": [
    "The Sacramento Valley hosts over 1 million geese each winter, including Ross's, snow, and white-fronted geese.",
    "California's Central Valley is the primary wintering ground for Pacific Flyway Aleutian cackling geese.",
    "Gray Lodge WMA near Gridley is one of the most popular public goose hunting areas in the Pacific Flyway."
  ],
  "Colorado": [
    "Colorado's Front Range urban areas host large resident Canada goose populations, making them accessible near major cities.",
    "The San Luis Valley in southern Colorado attracts thousands of migrating snow geese and Canada geese each fall.",
    "Barr Lake and Union Reservoir along the Front Range are key staging areas for Colorado's goose migration."
  ],
  "Connecticut": [
    "Connecticut's resident Canada goose population has grown to over 30,000, creating year-round hunting opportunities.",
    "The Connecticut River floodplain from Hartford to the coast is the state's primary goose migration corridor.",
    "Barn Island WMA on the coast provides the best public-access goose hunting in southeastern Connecticut."
  ],
  "Delaware": [
    "Bombay Hook NWR hosts tens of thousands of snow geese each fall, creating spectacular hunting in surrounding fields.",
    "Delaware's position on the Delmarva Peninsula puts it at the center of the Atlantic Flyway's goose migration.",
    "The agricultural fields of Kent and Sussex counties attract large flocks of Canada geese from November through February."
  ],
  "Florida": [
    "Florida's goose hunting is limited, but migratory Canada geese reach the northern panhandle in small numbers.",
    "Resident Canada geese have established breeding populations around Jacksonville and the northern tier of the state.",
    "Blue geese (dark-morph snow geese) occasionally appear in Florida's panhandle during severe northern winters."
  ],
  "Georgia": [
    "Georgia's piedmont region around Lake Oconee hosts a growing resident Canada goose population.",
    "The agricultural fields along the Savannah River floodplain attract migratory geese from the Atlantic Flyway.",
    "Altamaha WMA and surrounding coastal marshes provide limited but quality goose hunting in southeast Georgia."
  ],
  "Idaho": [
    "The Snake River Plain between Idaho Falls and Twin Falls hosts massive concentrations of wintering Canada geese.",
    "Market Lake WMA is Idaho's best public goose hunting destination with managed fields and blinds.",
    "Idaho's Hagerman Valley along the Snake River attracts one of the densest wintering goose populations in the Pacific Flyway."
  ],
  "Illinois": [
    "The Horseshoe Lake area near Cairo was once the Canada goose capital of the world, peaking at 500,000+ birds.",
    "Rend Lake and Union County are still top-tier goose destinations in southern Illinois.",
    "Illinois' light goose conservation order runs through spring, targeting overabundant snow and Ross's geese."
  ],
  "Indiana": [
    "Jasper-Pulaski FWA is Indiana's most famous goose hunting area, known for sandhill cranes and Canada geese.",
    "The Indiana Dunes area along Lake Michigan provides pass-shooting opportunities for migrating geese.",
    "Goose Pond FWA in Greene County has become one of the top interior goose hunting spots since its restoration."
  ],
  "Iowa": [
    "DeSoto NWR on the Missouri River hosts massive concentrations of snow geese during spring and fall migration.",
    "Iowa's snow goose conservation order allows electronic calls and unplugged guns to manage overabundant populations.",
    "Riverton WMA in Fremont County is Iowa's premier destination for Canada and white-fronted geese."
  ],
  "Kansas": [
    "Quivira NWR near Stafford hosts hundreds of thousands of geese during peak fall migration.",
    "Cheyenne Bottoms and the surrounding grain fields attract massive flights of white-fronted and Canada geese.",
    "Kansas' light goose conservation order runs into April, offering some of the latest goose hunting in the Central Flyway."
  ],
  "Kentucky": [
    "Ballard WMA at the confluence of the Ohio and Mississippi Rivers is Kentucky's premier goose area.",
    "Kentucky Lake and Lake Barkley attract large numbers of Canada geese from the upper Midwest.",
    "Peabody WMA's reclaimed mine lands in western Kentucky provide excellent goose hunting over grain fields."
  ],
  "Louisiana": [
    "Louisiana's coastal marshes and rice fields winter millions of snow, blue, and white-fronted geese.",
    "Lacassine NWR in Cameron Parish hosts some of the densest goose concentrations in the Mississippi Flyway.",
    "Louisiana's specklebelly (white-fronted goose) hunting is considered the best in North America."
  ],
  "Maine": [
    "Merrymeeting Bay is Maine's top goose hunting destination, where Canada geese stage during fall migration.",
    "Maine's early September resident goose season targets the growing local Canada goose population before migrants arrive.",
    "Scarborough Marsh and the Rachel Carson NWR provide coastal goose hunting along the Atlantic Flyway."
  ],
  "Maryland": [
    "Maryland's Eastern Shore is legendary for Canada goose hunting, particularly around Dorchester and Talbot counties.",
    "The Chesapeake Bay region historically wintered over 1 million Canada geese at its peak.",
    "Blackwater NWR and surrounding farm fields offer some of the most productive goose hunting on the East Coast."
  ],
  "Massachusetts": [
    "The Connecticut River valley from Springfield to Northampton is Massachusetts' primary goose migration corridor.",
    "Plum Island and the Parker River NWR attract flocks of Canada and snow geese along the coast.",
    "Massachusetts' resident Canada goose population exceeds 35,000, supporting an early season before regular waterfowl dates."
  ],
  "Michigan": [
    "Allegan State Game Area on the Kalamazoo River hosts one of the largest goose concentrations in the Great Lakes.",
    "Michigan's Saginaw Bay region attracts large numbers of Canada geese that feed on harvested sugar beet and corn fields.",
    "The Muskegon County Wastewater facility has become a major goose staging area, drawing thousands of Canadas each fall."
  ],
  "Minnesota": [
    "Minnesota's Lac qui Parle WMA was the original Canada goose restoration site and remains a premier destination.",
    "The Rochester area hosts one of the largest wintering Canada goose populations in the state, numbering over 30,000.",
    "Minnesota's light goose conservation order targets spring-migrating snow geese that are damaging Arctic breeding habitat."
  ],
  "Mississippi": [
    "The Yazoo-Mississippi Delta's agricultural fields attract substantial flights of snow and white-fronted geese.",
    "Noxubee NWR in Noxubee County is Mississippi's most reliable public-access goose hunting area.",
    "Mississippi's goose populations have increased steadily as snow goose numbers push into the Deep South."
  ],
  "Missouri": [
    "Swan Lake NWR in north-central Missouri hosts over 100,000 Canada geese at peak migration.",
    "Squaw Creek (Loess Bluffs) NWR attracts hundreds of thousands of snow geese each spring and fall.",
    "Missouri's managed goose hunting areas around Fountain Grove and Grand Pass offer some of the Midwest's best Canada goose hunting."
  ],
  "Montana": [
    "Freezout Lake near Choteau hosts over 300,000 snow geese during spring migration, one of the greatest spectacles in the West.",
    "Montana's Hi-Line region along the Milk River corridor produces excellent Canada goose hunting over grain stubble.",
    "Canyon Ferry Reservoir near Helena is a key staging area for fall-migrating Canada and snow geese."
  ],
  "Nebraska": [
    "The Rainwater Basin hosts millions of snow geese during spring migration, making Nebraska a light goose conservation hotspot.",
    "The Platte River corridor near Kearney attracts massive flocks of white-fronted geese alongside sandhill cranes.",
    "Nebraska's dark goose (Canada and white-fronted) hunting ranks among the best in the Central Flyway."
  ],
  "Nevada": [
    "Ruby Lake NWR in northeast Nevada is the state's best goose hunting destination with Canada and snow geese.",
    "Stillwater NWR near Fallon attracts migrating snow geese and Ross's geese through the Pacific Flyway.",
    "The Lahontan Valley agricultural fields near Fallon provide field hunting opportunities for Canada geese."
  ],
  "New Hampshire": [
    "Great Bay estuary near Durham is New Hampshire's most productive goose hunting area during fall migration.",
    "New Hampshire's early September season targets resident Canada geese, which have become abundant in the Merrimack Valley.",
    "Lake Umbagog NWR on the Maine border offers remote, low-pressure goose hunting in the North Country."
  ],
  "New Jersey": [
    "New Jersey's resident Canada goose population exceeds 100,000, one of the highest densities in the Atlantic Flyway.",
    "The Delaware Bay marshes and surrounding grain fields attract large flocks of migratory snow geese.",
    "Edwin B. Forsythe NWR (Brigantine) is a major staging area for Atlantic brant along the Jersey Shore."
  ],
  "New Mexico": [
    "Bosque del Apache NWR on the Rio Grande is the Southwest's most iconic goose wintering area with over 30,000 snow geese.",
    "The Pecos Valley and Bitter Lake NWR provide excellent goose hunting in eastern New Mexico.",
    "New Mexico's light goose conservation order allows spring hunting to manage overabundant snow goose populations."
  ],
  "New York": [
    "The Finger Lakes region is New York's top goose hunting area, with large flights of Canada geese over harvested corn fields.",
    "Jamaica Bay NWR in New York City hosts thousands of Atlantic brant and is a critical urban wildlife area.",
    "Montezuma NWR near Seneca Falls is a major staging area for Canada and snow geese on the Atlantic Flyway."
  ],
  "North Carolina": [
    "The Outer Banks and Pamlico Sound host the largest wintering population of Atlantic brant south of New Jersey.",
    "Mattamuskeet NWR is North Carolina's premier goose destination with tundra swans and Canada geese.",
    "Pea Island NWR on the Outer Banks is a critical stopover for snow geese moving along the Atlantic coast."
  ],
  "North Dakota": [
    "North Dakota's prairie potholes produce more Canada geese than nearly any other region in the lower 48.",
    "Devils Lake and the Souris River valley host massive fall concentrations of snow, Canada, and white-fronted geese.",
    "The spring light goose conservation order in North Dakota is among the most productive in the country."
  ],
  "Ohio": [
    "Ottawa NWR on Lake Erie is Ohio's top goose hunting destination, with massive flights of Canada geese.",
    "The Killbuck Marsh area in Wayne County provides excellent public-access goose hunting in the interior.",
    "Ohio's growing resident Canada goose population provides extended hunting opportunities from September through winter."
  ],
  "Oklahoma": [
    "Salt Plains NWR near Cherokee hosts tens of thousands of Canada and snow geese during fall migration.",
    "Oklahoma's Red River valley provides goose hunting over wheat fields, a regional tradition in the southern Central Flyway.",
    "Washita NWR near Butler is a reliable wintering area for Canada geese in southwestern Oklahoma."
  ],
  "Oregon": [
    "The Klamath Basin hosts one of the largest wintering populations of white-fronted geese in the Pacific Flyway.",
    "Sauvie Island WMA near Portland is Oregon's most popular goose hunting destination with Canada and cackling geese.",
    "Summer Lake WMA in Lake County provides remote goose hunting over flooded meadows in high-desert country."
  ],
  "Pennsylvania": [
    "Middle Creek WMA in Lebanon County hosts over 100,000 snow geese each spring, Pennsylvania's greatest wildlife spectacle.",
    "Pymatuning Reservoir attracts large numbers of Canada geese that feed on surrounding dairy farm fields.",
    "Pennsylvania's resident Canada goose population exceeds 250,000, supporting liberal seasons and bag limits."
  ],
  "Rhode Island": [
    "Ninigret NWR and the coastal salt ponds attract Atlantic brant and Canada geese during fall migration.",
    "Rhode Island's resident Canada goose population supports an early September season before regular waterfowl dates.",
    "The Great Swamp Management Area in South Kingstown is the state's best public goose hunting spot."
  ],
  "South Carolina": [
    "The ACE Basin's managed impoundments attract Canada geese and occasional snow geese to the coast.",
    "South Carolina's piedmont farm country around Abbeville and Laurens hosts growing Canada goose populations.",
    "Santee NWR near Summerton provides managed goose hunting opportunities in the central part of the state."
  ],
  "South Dakota": [
    "Sand Lake NWR near Aberdeen hosts hundreds of thousands of snow geese during fall migration.",
    "The Missouri River corridor, especially near Pierre, attracts massive flights of Canada and snow geese.",
    "South Dakota's spring light goose conservation order is one of the most popular in the Central Flyway."
  ],
  "Tennessee": [
    "Cross Creeks NWR on the Cumberland River near Dover is Tennessee's premier Canada goose area.",
    "Tennessee NWR near Paris attracts thousands of Canada geese to its managed agricultural fields.",
    "The Tennessee Valley's grain fields between Camden and Waverly provide excellent late-season goose hunting."
  ],
  "Texas": [
    "Texas winters more snow geese than any other state, with over 1 million along the Gulf Coast.",
    "The rice prairies near El Campo and Eagle Lake are legendary for white-fronted (specklebelly) goose hunting.",
    "The Texas Panhandle's playa lakes attract massive flights of Canada, snow, and white-fronted geese from the Central Flyway."
  ],
  "Utah": [
    "Bear River MBR hosts thousands of Canada geese and is Utah's premier goose hunting destination.",
    "The Cache Valley in northern Utah attracts large flocks of snow geese during spring migration.",
    "Farmington Bay WMA on the Great Salt Lake provides field and marsh goose hunting along the Pacific Flyway."
  ],
  "Vermont": [
    "Dead Creek WMA near Addison hosts thousands of snow geese each fall, Vermont's most iconic wildlife event.",
    "Missisquoi NWR on Lake Champlain is Vermont's best public goose hunting area with managed waterfowl units.",
    "Vermont's Champlain Valley agricultural fields attract large flights of Canada geese from October through December."
  ],
  "Virginia": [
    "Virginia's Eastern Shore is the southern terminus for many Atlantic Flyway Canada goose populations.",
    "Back Bay NWR near Virginia Beach hosts large concentrations of snow geese and tundra swans.",
    "The James River floodplain and surrounding grain fields attract migratory Canada geese from November through February."
  ],
  "Washington": [
    "The Skagit Valley near Mount Vernon hosts one of the largest wintering snow goose populations in the Pacific Flyway.",
    "Ridgefield NWR along the Columbia River is a key staging area for dusky Canada geese and cackling geese.",
    "The Columbia Basin's agricultural fields near Moses Lake provide excellent field hunting for Canada geese."
  ],
  "West Virginia": [
    "The Ohio River valley in the Northern Panhandle is West Virginia's most productive goose hunting corridor.",
    "McClintic WMA near Point Pleasant provides managed goose hunting over agricultural fields and impoundments.",
    "West Virginia's resident Canada goose population has expanded from urban areas into rural farmland across the state."
  ],
  "Wisconsin": [
    "Horicon NWR in Dodge County hosts over 200,000 Canada geese at peak fall migration.",
    "The Mississippi River corridor near La Crosse attracts large flights of snow and Canada geese.",
    "Wisconsin's early September season targets resident Canada geese before the main migratory flights arrive."
  ],
  "Wyoming": [
    "Seedskadee NWR along the Green River is Wyoming's most reliable goose hunting destination.",
    "The Bighorn Basin near Lovell and Greybull attracts wintering Canada geese that feed on irrigated grain fields.",
    "Ocean Lake near Riverton hosts both Canada and snow geese during fall migration through the Central Flyway."
  ],
};

const deerFacts: Record<string, string[]> = {
  "Alabama": [
    "Alabama harvests over 300,000 deer annually, one of the highest totals in the Southeast.",
    "The Black Belt region is famous for producing trophy whitetails with Boone & Crockett-class bucks.",
    "Alabama's deer season runs from mid-October to early February, one of the longest in the nation."
  ],
  "Alaska": [
    "Alaska offers hunting for Sitka blacktail deer in the coastal rainforests of Southeast Alaska and Kodiak Island.",
    "Kodiak Island is the most popular Sitka blacktail destination, with hunters averaging 2-3 deer per trip.",
    "Alaska has no whitetail or mule deer — Sitka blacktails are the only deer species in the state."
  ],
  "Arizona": [
    "Arizona's Coues whitetail deer, found in the southern mountains, is one of the most challenging trophies in North America.",
    "The Kaibab Plateau north of the Grand Canyon is legendary for producing trophy mule deer bucks.",
    "Arizona uses a draw system for most deer hunts, with some units having less than 5% tag success rates."
  ],
  "Arkansas": [
    "Arkansas harvests over 200,000 deer annually from a herd estimated at over 1 million animals.",
    "The Ozark National Forest provides vast public land hunting opportunities for whitetails.",
    "Arkansas allows the use of modern firearms, muzzleloaders, and archery equipment across separate seasons."
  ],
  "California": [
    "California has the largest mule deer population of any state, with an estimated 450,000 animals.",
    "Zone X in Lassen and Modoc counties is California's most popular deer hunting zone.",
    "California's blacktail deer in the Coast Range and Cascades are a subspecies unique to the Pacific Coast."
  ],
  "Colorado": [
    "Colorado holds the largest mule deer population in the nation at over 400,000 animals.",
    "Units 61 and 62 on the Uncompahgre Plateau have produced some of the state's biggest B&C mule deer.",
    "Colorado's 4th rifle season in November targets the mule deer rut, when mature bucks are most active."
  ],
  "Connecticut": [
    "Connecticut's deer density exceeds 30 per square mile in some areas, among the highest in New England.",
    "Fairfield County in southwestern CT consistently produces the state's largest whitetail bucks.",
    "Connecticut allows crossbow hunting during the entire archery season, expanding opportunity for more hunters."
  ],
  "Delaware": [
    "Despite its small size, Delaware harvests over 12,000 deer annually from a dense population.",
    "Sussex County in southern Delaware produces the majority of the state's trophy whitetail bucks.",
    "Delaware allows shotguns only for firearm deer season — no centerfire rifles are permitted."
  ],
  "Florida": [
    "Florida has three deer subspecies: the Osceola, the Virginia whitetail, and the diminutive Key deer (protected).",
    "Eglin Air Force Base in the Panhandle offers some of Florida's best public deer hunting at over 460,000 acres.",
    "Florida's deer season can start as early as July in some zones, the earliest opener in the country."
  ],
  "Georgia": [
    "Georgia harvests approximately 350,000 deer per season, ranking in the top 5 nationally.",
    "Dooly and Hancock counties in central Georgia consistently produce trophy whitetails over 150 B&C.",
    "Georgia allows baiting for deer in most counties, a practice prohibited in many other states."
  ],
  "Hawaii": [
    "Hawaii offers hunting for axis deer on Maui, Molokai, and Lanai — an exotic species introduced in 1868.",
    "Lanai was once known as the 'Pineapple Island' but now has more axis deer than any other Hawaiian island.",
    "Hawaii's axis deer have no natural predators and cause significant agricultural damage, making hunting a management tool."
  ],
  "Idaho": [
    "Idaho offers mule deer, whitetail, and even Coeur d'Alene whitetails in the panhandle's dense forests.",
    "The Clearwater Region (Units 10-17) is famous for producing trophy whitetail bucks in the river breaks.",
    "Idaho's general season tags are available over-the-counter, making it one of the most accessible western states."
  ],
  "Illinois": [
    "Illinois is a top-5 state for Boone & Crockett whitetails, with Pike County being the epicenter.",
    "Illinois is a shotgun/muzzleloader/archery-only state — no centerfire rifles are allowed for deer.",
    "The Golden Triangle of Pike, Adams, and Brown counties has produced more B&C entries than most entire states."
  ],
  "Indiana": [
    "Indiana harvests over 120,000 deer annually, with Parke and Brown counties being top producers.",
    "Indiana allows rifles only in specific counties — most of the state is restricted to shotgun, muzzleloader, and handgun.",
    "The southern Indiana hills and creek bottoms produce the state's largest typical whitetail racks."
  ],
  "Iowa": [
    "Iowa is widely considered the #1 state for trophy whitetails, with more B&C entries per square mile than anywhere.",
    "Iowa's one-buck limit and limited nonresident tags keep hunting pressure low and buck age structure high.",
    "Allamakee, Clayton, and Winneshiek counties in northeast Iowa consistently produce 170+ class bucks."
  ],
  "Kansas": [
    "Kansas ranks in the top 3 for Boone & Crockett whitetails, rivaling Iowa and Illinois.",
    "The Flint Hills region's mix of tallgrass prairie and creek timber produces massive whitetail bucks.",
    "Kansas allows hunters to harvest one buck per season, maintaining older age classes in the herd."
  ],
  "Kentucky": [
    "Kentucky harvests over 130,000 deer annually and has produced multiple B&C world-class whitetails.",
    "The Land Between the Lakes NRA offers 170,000 acres of public land hunting in western Kentucky.",
    "Kentucky's archery season opens in early September, one of the earliest bow seasons in the East."
  ],
  "Louisiana": [
    "Louisiana's deer population exceeds 1 million, concentrated in the piney woods and bottomland hardwoods.",
    "The Atchafalaya Basin and surrounding areas produce some of the heaviest-bodied whitetails in the South.",
    "Louisiana allows dogs for deer hunting in certain parishes, a traditional practice dating back centuries."
  ],
  "Maine": [
    "Maine's North Woods hold the largest whitetail deer in New England, with bucks commonly exceeding 200 lbs.",
    "Aroostook and Penobscot counties in northern Maine produce the state's biggest bucks consistently.",
    "Maine allows hunters to use rifles statewide, including .30-06 and .308 — a tradition since territorial days."
  ],
  "Maryland": [
    "Maryland's deer density exceeds 40 per square mile in parts of the Western Shore, among the highest in the East.",
    "The agricultural counties of Frederick, Washington, and Carroll produce trophy whitetails year after year.",
    "Maryland offers managed hunts at military installations like Aberdeen Proving Ground with exceptional buck quality."
  ],
  "Massachusetts": [
    "Massachusetts' deer population has grown to over 95,000, concentrated on Cape Cod and in the Connecticut Valley.",
    "Nantucket Island has an extremely dense deer herd and extended seasons to manage the population.",
    "The Quabbin Reservoir in central MA offers controlled hunts on some of the state's best whitetail habitat."
  ],
  "Michigan": [
    "Michigan has over 1.5 million deer and issues more deer licenses than any state except Texas.",
    "The Upper Peninsula offers vast public land and a chance at trophy bucks in a wilderness setting.",
    "Michigan's firearm season opener on November 15 is an unofficial state holiday, with over 600,000 hunters afield."
  ],
  "Minnesota": [
    "Minnesota harvests over 200,000 deer annually from a herd of approximately 1 million whitetails.",
    "The bluff country of southeastern Minnesota (Houston, Fillmore counties) produces the state's biggest B&C bucks.",
    "Minnesota's CWD management zones in the southeast have created new regulations for carcass transport and testing."
  ],
  "Mississippi": [
    "Mississippi's deer herd exceeds 1.5 million, one of the largest per-capita populations in the country.",
    "The Delta region's fertile agricultural land grows trophy whitetails with wide, heavy antlers.",
    "Mississippi allows hunters to harvest up to 5 bucks per season on private land in some zones."
  ],
  "Missouri": [
    "Missouri is a top-10 B&C whitetail state, with Pike, Macon, and Mercer counties leading the way.",
    "The Mark Twain National Forest provides over 1.5 million acres of public deer hunting in the Ozarks.",
    "Missouri's firearms season in November typically yields over 100,000 deer in just 11 days."
  ],
  "Montana": [
    "Montana offers both mule deer and whitetail hunting, with the Breaks country producing giant muleys.",
    "The Missouri River Breaks have produced some of the largest typical mule deer in B&C history.",
    "Montana's general deer tag covers both species and is available over-the-counter for residents."
  ],
  "Nebraska": [
    "Nebraska's Pine Ridge and Wildcat Hills in the northwest panhandle produce trophy mule deer bucks.",
    "The Republican River valley in southwest Nebraska is known for giant whitetails in the creek-bottom timber.",
    "Nebraska offers over-the-counter rifle tags for both mule deer and whitetails in many units."
  ],
  "Nevada": [
    "Nevada's mule deer thrive in the high desert mountain ranges, with some units producing 30-inch bucks.",
    "The Ruby Mountains near Elko are Nevada's most sought-after mule deer unit.",
    "Nevada's tag system is draw-only, with some premium units requiring 10+ bonus points to draw."
  ],
  "New Hampshire": [
    "New Hampshire's deer herd has grown to over 100,000, with the Merrimack Valley being the densest region.",
    "Hillsborough and Rockingham counties in southern NH consistently produce the state's biggest whitetail bucks.",
    "New Hampshire's muzzleloader season extends through December, offering late-season opportunities after rifle season."
  ],
  "New Jersey": [
    "New Jersey has one of the highest deer densities in the nation at over 40 per square mile in some areas.",
    "Hunterdon and Warren counties in northwest NJ are the top trophy whitetail producers in the state.",
    "New Jersey's six-day firearm season with shotgun-only rules creates intense, productive hunting."
  ],
  "New Mexico": [
    "New Mexico offers mule deer, Coues whitetail, and even free-range elk on the same hunt in some units.",
    "The Gila National Forest in southwest NM produces trophy Coues whitetails in rugged canyon country.",
    "New Mexico's Unit 2B near Chama is one of the most coveted mule deer draw tags in the West."
  ],
  "New York": [
    "New York harvests over 200,000 deer annually, with the Southern Tier and Adirondacks being top regions.",
    "The Catskill Mountains and surrounding counties (Delaware, Sullivan, Orange) produce big-bodied whitetails.",
    "New York City's Staten Island has a controlled archery program to manage its suburban deer herd."
  ],
  "North Carolina": [
    "North Carolina's coastal plain produces the state's largest whitetails, with Tyrrell and Hyde counties leading.",
    "The Uwharrie National Forest in the Piedmont offers quality public land bow hunting for whitetails.",
    "North Carolina allows the use of dogs for deer hunting in the coastal plain, a longstanding tradition."
  ],
  "North Dakota": [
    "North Dakota's badlands in the western part of the state produce trophy mule deer bucks.",
    "The Theodore Roosevelt National Park area is surrounded by prime mule deer habitat in the Little Missouri breaks.",
    "North Dakota's whitetail populations have exploded along the river valleys and shelterbelts of the eastern prairie."
  ],
  "Ohio": [
    "Ohio ranks in the top 5 nationally for Boone & Crockett whitetails and is an archery hunting mecca.",
    "The southeastern hill country (Guernsey, Tuscarawas, Coshocton counties) consistently produces monster bucks.",
    "Ohio is shotgun/muzzleloader-only for gun season — no centerfire rifles — contributing to higher buck survival."
  ],
  "Oklahoma": [
    "Oklahoma offers both whitetail and mule deer, with the Wichita Mountains providing a unique crossover zone.",
    "The southeastern counties of Pushmataha and LeFlore produce Oklahoma's biggest whitetail bucks.",
    "Oklahoma's generous six-deer bag limit (multiple bucks allowed) is one of the most liberal in the country."
  ],
  "Oregon": [
    "Oregon offers blacktail deer on the west side and mule deer on the east side of the Cascades.",
    "The Steens Mountain and Hart Mountain areas in southeast Oregon produce trophy Rocky Mountain mule deer.",
    "Oregon's Roosevelt elk country in the Coast Range also holds excellent blacktail deer populations."
  ],
  "Pennsylvania": [
    "Pennsylvania has one of the largest deer herds in the East at over 1.5 million animals.",
    "The north-central counties (Potter, Tioga, Clinton) are the heart of Pennsylvania's Big Woods hunting tradition.",
    "Pennsylvania's concurrent antlerless season during rifle season allows harvesting a doe on the same day as a buck."
  ],
  "Rhode Island": [
    "Rhode Island's deer population exceeds 18,000, high density for the smallest state in the nation.",
    "The Arcadia Management Area in the western part of the state offers the best public deer hunting.",
    "Rhode Island allows crossbows during the entire archery season, increasing opportunity in this densely settled state."
  ],
  "South Carolina": [
    "South Carolina's deer season runs August through January, one of the longest continuous seasons in the country.",
    "The Lowcountry's ACE Basin and Santee Delta produce heavy-bodied whitetails with unique antler characteristics.",
    "South Carolina allows hunting on Sundays and permits the use of dogs for deer drives in many counties."
  ],
  "South Dakota": [
    "South Dakota's Black Hills produce trophy mule deer, while the Missouri River breaks hold giant whitetails.",
    "Gregory and Charles Mix counties along the Missouri are consistently top-producing whitetail areas.",
    "South Dakota's West River mule deer tags are available over-the-counter for residents in most units."
  ],
  "Tennessee": [
    "Tennessee harvests over 150,000 deer annually, with the western part of the state producing the most.",
    "The Land Between the Lakes NRA offers some of the best public land buck hunting in the Southeast.",
    "Fayette and Hardeman counties in western Tennessee consistently produce trophy whitetails over 150 inches."
  ],
  "Texas": [
    "Texas has the largest deer herd in the country at over 5 million whitetails and mule deer.",
    "The South Texas Brush Country produces the biggest whitetail bucks in the state, with 200+ B&C entries.",
    "The Hill Country has the highest deer density in the nation, but smaller body and antler size due to habitat pressure."
  ],
  "Utah": [
    "Utah's mule deer population is concentrated on the Wasatch Front and high plateaus of the central mountains.",
    "The Henry Mountains and Paunsaugunt units are Utah's most coveted limited-entry mule deer tags.",
    "Utah introduced the dedicated hunter program, requiring 40 hours of conservation service for a 3-year general tag."
  ],
  "Vermont": [
    "Vermont's Green Mountains and Northeast Kingdom provide a classic New England deer hunting experience.",
    "Bennington and Windham counties in southern Vermont produce the state's largest whitetail bucks.",
    "Vermont's November rifle season is a deeply ingrained cultural tradition, with opening day treated as an unofficial holiday."
  ],
  "Virginia": [
    "Virginia harvests over 200,000 deer annually, with the Shenandoah Valley being the most productive region.",
    "Rappahannock and Fauquier counties in the Piedmont consistently produce Virginia's biggest B&C whitetails.",
    "Virginia allows hunting on Sundays on private land and select public lands, expanded in recent years."
  ],
  "Washington": [
    "Washington offers blacktail on the west side, mule deer in the east, and whitetails in the northeast corner.",
    "The Blue Mountains in southeast Washington produce the state's largest mule deer bucks.",
    "Washington's Methow Valley and Okanogan region provide premier mule deer hunting in the North Cascades."
  ],
  "West Virginia": [
    "West Virginia harvests over 100,000 deer annually from its mountainous terrain and deep hollows.",
    "Hampshire, Hardy, and Grant counties in the Eastern Panhandle produce the state's biggest whitetails.",
    "West Virginia's buck-only firearms season in November is followed by an antlerless-only season in December."
  ],
  "Wisconsin": [
    "Wisconsin's 9-day gun season is a cultural phenomenon, with over 600,000 hunters taking to the woods.",
    "Buffalo and Trempealeau counties in the Driftless Area consistently produce the state's largest B&C bucks.",
    "Wisconsin's CWD management in the southern farmland zone has created intensive harvest regulations since 2002."
  ],
  "Wyoming": [
    "Wyoming offers mule deer and whitetail hunting across diverse terrain from prairie to alpine.",
    "The Wyoming Range and Salt River Range in the western part of the state produce trophy mule deer.",
    "Wyoming's general deer tags are available over-the-counter for residents, covering vast public land."
  ],
};

const turkeyFacts: Record<string, string[]> = {
  "Alabama": [
    "Alabama's Black Belt and Tombigbee River corridor are legendary spring gobbler destinations.",
    "Alabama was a key state in the wild turkey restoration that brought the species back from near-extinction.",
    "Lowndes and Marengo counties in the Black Belt consistently produce some of the best gobbler hunting in the South."
  ],
  "Arizona": [
    "Arizona offers hunting for Merriam's wild turkeys in the ponderosa pine forests of the Mogollon Rim.",
    "The Kaibab National Forest north of Flagstaff is Arizona's top Merriam's turkey destination.",
    "Arizona's Gould's turkey in the extreme southeast is one of the rarest subspecies in the U.S."
  ],
  "Arkansas": [
    "Arkansas has one of the strongest turkey populations in the nation at over 200,000 birds.",
    "The Ozark National Forest provides vast public land for spring gobbler hunting.",
    "Pope and Yell counties in the Arkansas River Valley are consistently top turkey harvest areas."
  ],
  "California": [
    "California's Rio Grande and hybrid turkeys thrive in the oak woodlands of the Central Coast and Sierra foothills.",
    "Tehama and Shasta counties in northern California offer excellent spring hunting on public land.",
    "California has both spring and fall turkey seasons, with the fall season allowing either-sex harvest."
  ],
  "Colorado": [
    "Colorado's Merriam's turkeys inhabit the ponderosa pine forests along the Front Range and in the San Juans.",
    "Rio Grande turkeys thrive along the eastern Colorado river valleys and the Arkansas River corridor.",
    "The Spanish Peaks area near Trinidad offers hunting for both Merriam's and Rio Grande subspecies."
  ],
  "Connecticut": [
    "Connecticut's wild turkey population has grown from 0 to over 30,000 since reintroduction in the 1970s.",
    "Litchfield County in the northwest hills is Connecticut's best spring gobbler hunting region.",
    "Connecticut's fall shotgun turkey season allows either-sex harvest to manage the growing population."
  ],
  "Delaware": [
    "Delaware's turkey population has rebounded to over 3,000 birds, concentrated in Kent and Sussex counties.",
    "The Blackbird State Forest and surrounding agricultural land provide the state's best gobbler hunting.",
    "Delaware's spring season is limited to a 2-bird bag limit with shotgun-only regulations."
  ],
  "Florida": [
    "Florida's Osceola turkey is a unique subspecies found nowhere else in the world.",
    "Completing the Grand Slam requires hunting Florida for the Osceola, making it a bucket-list destination.",
    "Osceola National Forest and the Green Swamp are premier public land Osceola turkey areas."
  ],
  "Georgia": [
    "Georgia has one of the largest turkey populations in the Southeast at over 300,000 birds.",
    "The Chattahoochee National Forest in the north Georgia mountains provides excellent spring gobbler hunting.",
    "Talbot and Harris counties in the Piedmont are consistently top turkey harvest areas."
  ],
  "Hawaii": [
    "Hawaii has introduced Rio Grande wild turkeys on the Big Island, Maui, and Molokai.",
    "The Parker Ranch area on the Big Island offers some of Hawaii's best turkey hunting.",
    "Hawaii has both spring and fall turkey seasons with liberal bag limits to manage the non-native populations."
  ],
  "Idaho": [
    "Idaho's Merriam's turkeys thrive in the pine forests of the central mountains and Clearwater region.",
    "The Salmon River and Middle Fork country offer remote turkey hunting in true wilderness settings.",
    "Idaho allows over-the-counter spring turkey tags, making it one of the most accessible western turkey states."
  ],
  "Illinois": [
    "Illinois has one of the most successful turkey restoration stories, growing from 0 to over 150,000 birds.",
    "The Shawnee National Forest in southern Illinois is the state's top public land turkey destination.",
    "Jo Daviess and Calhoun counties along the Mississippi River produce consistently high gobbler harvests."
  ],
  "Indiana": [
    "Indiana's turkey population exceeds 100,000, with the southern hills being the most productive region.",
    "Brown County and the surrounding Hoosier National Forest offer excellent spring hunting on public land.",
    "Indiana's spring season opens in late April, timed to coincide with peak gobbling activity."
  ],
  "Iowa": [
    "Iowa's eastern timber counties consistently produce trophy gobblers with long beards and heavy spurs.",
    "Shimek State Forest and Stephens State Forest in southeast Iowa are top public turkey hunting areas.",
    "Iowa's fall shotgun season allows either-sex harvest and includes an additional archery-only option."
  ],
  "Kansas": [
    "Kansas has all four major subspecies of wild turkey: Eastern, Rio Grande, Merriam's, and hybrids.",
    "The Red Hills and Gyp Hills of south-central Kansas are legendary Rio Grande turkey country.",
    "Kansas allows hunters to take 2 bearded turkeys per spring season on a single tag."
  ],
  "Kentucky": [
    "Kentucky's Land Between the Lakes NRA provides outstanding public land gobbler hunting on 170,000 acres.",
    "Kentucky's turkey population has recovered to over 200,000 birds from near-extinction in the mid-1900s.",
    "Wayne and McCreary counties in southeastern Kentucky are consistently top spring harvest areas."
  ],
  "Louisiana": [
    "Louisiana's bottomland hardwoods along the Mississippi River provide unique turkey hunting in flooded timber transitions.",
    "Kisatchie National Forest's longleaf pine ecosystem supports healthy turkey populations in central Louisiana.",
    "Louisiana's spring season is one of the earliest in the Southeast, opening in late March in some zones."
  ],
  "Maine": [
    "Maine's turkey population has grown from 0 to over 60,000 since reintroduction in the 1970s.",
    "York and Oxford counties in southwestern Maine consistently produce the most gobblers.",
    "Maine allows both spring (bearded only) and fall (either-sex) turkey seasons with separate permits."
  ],
  "Maryland": [
    "Maryland's western counties (Garrett, Allegany, Washington) are the state's best spring turkey destinations.",
    "Green Ridge State Forest in Allegany County offers over 46,000 acres of public turkey hunting.",
    "Maryland's spring turkey season has a 2-bird limit, among the most generous in the Mid-Atlantic."
  ],
  "Massachusetts": [
    "Massachusetts' turkey population has grown explosively, now exceeding 25,000 birds from 37 released in 1972.",
    "The Berkshires and Connecticut River Valley in western MA offer the best gobbler hunting.",
    "Massachusetts turkeys have adapted to suburban environments, with huntable populations near major metro areas."
  ],
  "Michigan": [
    "Michigan's turkey population exceeds 200,000, with the southwestern Lower Peninsula being the most productive.",
    "Allegan and Ionia counties consistently lead Michigan in spring turkey harvest.",
    "Michigan offers a youth hunt weekend before the regular spring season to introduce new hunters to the sport."
  ],
  "Minnesota": [
    "Minnesota's southeast bluff country along the Mississippi River is the state's premier turkey hunting region.",
    "Houston and Fillmore counties in the Driftless Area produce the heaviest gobblers in the state.",
    "Minnesota's fall season is limited to specific permit areas in the southern and central parts of the state."
  ],
  "Mississippi": [
    "Mississippi's Tombigbee National Forest and Black Belt prairies are prime turkey habitat.",
    "Kemper and Noxubee counties in east-central Mississippi are consistently top gobbler harvest areas.",
    "Mississippi's spring season runs 44 days, one of the longest in the Southeast."
  ],
  "Missouri": [
    "Missouri pioneered modern wild turkey management and helped supply birds for reintroduction across the nation.",
    "The Ozarks region holds the state's highest turkey densities in mature oak-hickory forests.",
    "Shannon and Texas counties in the southern Ozarks are legendary Missouri gobbler destinations."
  ],
  "Montana": [
    "Montana's Merriam's turkeys inhabit the ponderosa pine forests of the southeastern part of the state.",
    "The Long Pines and Short Pines areas near Ekalaka are Montana's top turkey hunting destinations.",
    "Montana allows over-the-counter spring tags in some districts, with fall tags available by draw."
  ],
  "Nebraska": [
    "Nebraska has both Merriam's and Rio Grande turkeys, with Eastern turkeys in the southeast river bottoms.",
    "The Pine Ridge in northwestern Nebraska is the state's best Merriam's turkey destination.",
    "Nebraska's Niobrara River corridor supports all three turkey subspecies where their ranges overlap."
  ],
  "Nevada": [
    "Nevada's Merriam's turkeys are found in the mountain ranges of the northern and central parts of the state.",
    "The Jarbidge Mountains and Ruby Mountains are Nevada's most productive turkey hunting areas.",
    "Nevada's turkey tags are limited-draw in most units, maintaining quality hunting experiences."
  ],
  "New Hampshire": [
    "New Hampshire's turkey population has grown to over 40,000 from just 25 birds released in 1975.",
    "Sullivan and Cheshire counties in the southwestern part of the state produce the most gobblers.",
    "New Hampshire's fall turkey season allows either-sex harvest with shotgun or archery."
  ],
  "New Jersey": [
    "New Jersey's turkey population exceeds 20,000, thriving in the agricultural-forest interface.",
    "Sussex and Warren counties in northwestern NJ are the top turkey hunting destinations.",
    "New Jersey's spring season runs nearly a month, with separate zones and opening dates."
  ],
  "New Mexico": [
    "New Mexico offers Merriam's, Rio Grande, and Gould's turkey subspecies — all three in one state.",
    "The Gila National Forest is New Mexico's premier Merriam's turkey destination.",
    "The Sangre de Cristo Mountains near Santa Fe and Taos provide excellent high-elevation turkey hunting."
  ],
  "New York": [
    "New York has a thriving turkey population exceeding 250,000 birds statewide.",
    "The Catskill Mountains and Finger Lakes regions are New York's most productive gobbler areas.",
    "Steuben and Allegany counties in the Southern Tier consistently lead the state in spring harvest."
  ],
  "North Carolina": [
    "North Carolina's Uwharrie National Forest in the Piedmont is the state's top public land turkey spot.",
    "The Appalachian foothills of Wilkes and Surry counties produce impressive Eastern gobblers.",
    "North Carolina allows both spring and fall turkey seasons with separate bag limits for each."
  ],
  "North Dakota": [
    "North Dakota's Merriam's turkeys in the Badlands and Little Missouri Grasslands provide Western hunting experiences.",
    "The Missouri River breaks and cottonwood bottoms hold the state's Eastern turkey populations.",
    "North Dakota's spring turkey tags are available over-the-counter for residents in most units."
  ],
  "Ohio": [
    "Ohio's turkey population exceeds 200,000, with the southeast hill country being the stronghold.",
    "Athens, Morgan, and Washington counties in the Appalachian foothills produce the most spring gobblers.",
    "Ohio's Wayne National Forest provides the best public land turkey hunting in the state."
  ],
  "Oklahoma": [
    "Oklahoma offers both Eastern turkeys in the east and Rio Grande turkeys from central Oklahoma westward.",
    "The Ouachita Mountains in southeastern Oklahoma are the state's best Eastern turkey destination.",
    "McCurtain and LeFlore counties consistently produce Oklahoma's highest spring gobbler harvests."
  ],
  "Oregon": [
    "Oregon has both Merriam's and Rio Grande turkeys, with the Merriam's in the east and Rios in the south.",
    "The Ochoco and Malheur National Forests provide excellent public land Merriam's turkey hunting.",
    "Oregon allows two bearded turkeys per spring season, with a fall either-sex season as well."
  ],
  "Pennsylvania": [
    "Pennsylvania's turkey population exceeds 250,000, among the highest in the East.",
    "The north-central counties of Potter, Tioga, and Lycoming are Pennsylvania's Big Woods turkey country.",
    "Pennsylvania's 2-week spring season consistently produces over 30,000 gobblers annually."
  ],
  "Rhode Island": [
    "Rhode Island's turkey population has grown from zero to over 3,500 since reintroduction in 1980.",
    "The Arcadia Management Area and George Washington Management Area offer the best public turkey hunting.",
    "Rhode Island's spring season is shotgun-only with a 1-bird limit and a short season window."
  ],
  "South Carolina": [
    "South Carolina's Lowcountry plantations and Francis Marion National Forest offer classic Eastern turkey hunting.",
    "The Santee-Cooper area and surrounding counties produce some of the heaviest gobblers in the state.",
    "South Carolina's spring season opens in mid-March, one of the earliest in the Southeast."
  ],
  "South Dakota": [
    "South Dakota's Black Hills are the state's premier Merriam's turkey destination.",
    "The Missouri River breaks and Cedar River valley hold growing Eastern turkey populations.",
    "South Dakota allows over-the-counter spring turkey tags in the Black Hills and prairie units."
  ],
  "Tennessee": [
    "Tennessee consistently ranks in the top 5 nationally for spring gobbler harvest.",
    "The Cumberland Plateau and the Tennessee River corridor are the state's most productive regions.",
    "Fentress and Morgan counties in the Upper Cumberland are legendary Tennessee gobbler destinations."
  ],
  "Texas": [
    "Texas has the largest Rio Grande turkey population in the world, concentrated in the Edwards Plateau.",
    "The Hill Country around Mason and Llano counties is the epicenter of Rio Grande turkey hunting.",
    "Texas hunters harvest over 50,000 turkeys annually, with both spring and fall seasons available."
  ],
  "Utah": [
    "Utah's Merriam's turkeys were successfully introduced in the 1950s and now number over 20,000.",
    "The Wasatch Mountains and Fishlake National Forest provide Utah's best turkey hunting.",
    "Utah's limited-entry turkey permits ensure low hunting pressure and quality hunting experiences."
  ],
  "Vermont": [
    "Vermont's turkey population has grown to over 45,000 from just 17 birds released in 1969.",
    "Bennington and Rutland counties in the southern Green Mountains produce the most spring gobblers.",
    "Vermont's fall turkey season allows either-sex harvest and includes both archery and shotgun options."
  ],
  "Virginia": [
    "Virginia harvests over 15,000 gobblers annually, with the Blue Ridge and Piedmont leading production.",
    "Bath, Highland, and Augusta counties in the Allegheny Mountains are Virginia's top turkey areas.",
    "Virginia was one of the first states to successfully restore wild turkey populations in the 1950s-60s."
  ],
  "Washington": [
    "Washington's Merriam's and Rio Grande turkeys are found east of the Cascades in pine and oak habitat.",
    "The Blue Mountains near Dayton and the Colville National Forest are the top turkey destinations.",
    "Washington offers both spring and fall turkey seasons with generous 3-bird bag limits."
  ],
  "West Virginia": [
    "West Virginia's rugged Appalachian terrain produces challenging and rewarding Eastern gobbler hunting.",
    "Randolph and Pocahontas counties in the Allegheny Mountains are the state's premier gobbler areas.",
    "West Virginia's spring season runs nearly a month, with both bearded-only and youth hunt options."
  ],
  "Wisconsin": [
    "Wisconsin's turkey population has exploded from 0 to over 350,000 since reintroduction in 1976.",
    "Grant and Crawford counties in the Driftless Area are Wisconsin's top spring gobbler producers.",
    "Wisconsin's zone system distributes hunting pressure, with 7 time periods across multiple zones."
  ],
  "Wyoming": [
    "Wyoming's Merriam's turkeys inhabit the Black Hills and pine-covered ridges of the northeast.",
    "The Bear Lodge Mountains and Devils Tower area provide Wyoming's best turkey hunting.",
    "Wyoming offers limited-quota spring turkey tags by draw, ensuring quality hunting with low pressure."
  ],
};

const doveFacts: Record<string, string[]> = {
  "Alabama": [
    "Alabama's September dove opener is a social tradition, with family and friends gathering on sunflower fields.",
    "The Black Belt's agricultural fields produce some of the highest dove densities in the Southeast.",
    "Alabama allows 15 doves per day and permits the use of spinning-wing decoys on managed fields."
  ],
  "Arizona": [
    "Arizona's white-winged dove population has exploded, making the state a premier destination for September hunting.",
    "The agricultural valleys around Yuma, Buckeye, and Casa Grande are Arizona's top dove hunting areas.",
    "Arizona holds a special early white-winged dove season before the regular mourning dove opener."
  ],
  "Arkansas": [
    "Arkansas' rice and soybean fields in the Grand Prairie attract massive concentrations of mourning doves.",
    "The September 1 dove opener is one of the most anticipated hunting dates on the Arkansas calendar.",
    "Stuttgart and the surrounding Delta region offer managed public dove fields on WMAs."
  ],
  "California": [
    "California is one of the top dove-harvesting states, with hunters taking over 1 million birds annually.",
    "The Imperial Valley and Sacramento Valley are California's premier dove hunting corridors.",
    "Eurasian collared-doves can be taken without limit in California — they don't count toward the mourning dove bag."
  ],
  "Colorado": [
    "Colorado's eastern plains along the Arkansas River corridor provide excellent mourning dove hunting over grain stubble.",
    "The Front Range urban-rural interface produces surprisingly good dove hunting near Denver and Colorado Springs.",
    "Colorado's dove season opens September 1, coinciding with peak mourning dove migration through the Central Flyway."
  ],
  "Connecticut": [
    "Connecticut was one of the last states to open a mourning dove season, first allowing hunting in 2021.",
    "Dove hunting in Connecticut is limited to specific state-managed fields with registration required.",
    "The Connecticut River valley and eastern lowlands provide the best dove habitat in the state."
  ],
  "Delaware": [
    "Delaware's agricultural fields in Sussex County attract heavy mourning dove concentrations in September.",
    "Managed dove fields at state WMAs like Cedar Swamp and Assawoman offer public hunting opportunities.",
    "Delaware's dove season spans September through January, providing extended hunting opportunities."
  ],
  "Florida": [
    "Florida's dove season opens in early October, later than most states due to the warm climate.",
    "The agricultural areas around Lake Okeechobee and the Kissimmee Prairie are Florida's top dove areas.",
    "Eurasian collared-doves have become abundant in Florida and can be harvested without bag limits."
  ],
  "Georgia": [
    "Georgia's managed dove fields on WMAs are among the best public-access opportunities in the Southeast.",
    "The agricultural counties of the Piedmont from Macon to Augusta produce excellent September dove shoots.",
    "Di-Lane WMA and Rum Creek WMA host popular managed dove hunts with draw-based access."
  ],
  "Idaho": [
    "Idaho's Snake River Plain and Treasure Valley are the state's most productive dove hunting areas.",
    "The agricultural fields near Boise, Nampa, and Caldwell attract large September mourning dove flights.",
    "Idaho's dove season opens September 1, with limits of 15 birds per day in the Pacific Flyway."
  ],
  "Illinois": [
    "Illinois ranks in the top 10 nationally for mourning dove harvest, with over 500,000 taken annually.",
    "The agricultural counties of central and southern Illinois are the state's dove hunting heartland.",
    "Public dove fields at state sites like Jim Edgar Panther Creek and Clinton Lake offer managed hunts."
  ],
  "Indiana": [
    "Indiana's September dove opener is one of the most popular small game hunting events in the state.",
    "The Wabash Valley and White River agricultural corridors attract heavy dove concentrations.",
    "Dove hunting over managed sunflower fields at state fish and wildlife areas is an Indiana tradition."
  ],
  "Iowa": [
    "Iowa's agricultural landscape provides excellent mourning dove hunting over harvested grain fields.",
    "The Missouri and Mississippi River valleys concentrate doves during their September southward migration.",
    "Iowa's dove season runs September through November, covering both the early flight and lingering birds."
  ],
  "Kansas": [
    "Kansas is a top-5 state for dove harvest, with the Flint Hills and south-central prairies leading production.",
    "Cheyenne Bottoms and the surrounding farmland attract massive dove flights in early September.",
    "Kansas allows 15 doves per day and its September opener is considered the unofficial start to hunting season."
  ],
  "Kentucky": [
    "Kentucky's dove fields at Peabody and West Kentucky WMAs provide popular managed public hunts.",
    "The bluegrass region's horse farms and agricultural fields attract strong September dove flights.",
    "Kentucky harvests over 500,000 mourning doves annually, ranking in the top 15 nationally."
  ],
  "Louisiana": [
    "Louisiana's September dove opener is a major social event, with plantation hunts and field gatherings statewide.",
    "The rice prairies of Acadiana and the cotton fields of northeast Louisiana are top dove areas.",
    "Louisiana hunters take over 1 million doves per season, ranking in the top 5 nationally."
  ],
  "Maryland": [
    "Maryland's Eastern Shore grain fields provide excellent dove hunting over cut corn and sunflower fields.",
    "Managed dove fields at state WMAs like LeCompte and E.A. Vaughn offer regulated public hunts.",
    "Queen Anne's and Caroline counties are consistently top mourning dove harvest areas in Maryland."
  ],
  "Michigan": [
    "Michigan's September dove season is relatively new, with mourning dove hunting legalized in 2004.",
    "The southern Lower Peninsula's agricultural counties provide the best dove habitat and hunting.",
    "Managed dove fields at Sharonville and Gratiot-Saginaw State Game Areas offer public hunting opportunities."
  ],
  "Minnesota": [
    "Minnesota's dove season runs September through November in the southern and central parts of the state.",
    "The agricultural counties of the Minnesota River valley and southeastern bluff country produce the most doves.",
    "Minnesota was one of the last Midwestern states to open a dove season, beginning in 2004."
  ],
  "Mississippi": [
    "Mississippi ranks in the top 10 for dove harvest, with the Delta's grain fields attracting massive flights.",
    "Managed dove fields on WMAs across the state provide some of the best public-access hunting in the Southeast.",
    "The September 1 opener is Mississippi's most popular small game hunting day of the year."
  ],
  "Missouri": [
    "Missouri hunters harvest over 1.5 million doves per season, consistently ranking in the top 5 nationally.",
    "The agricultural heartland of north-central Missouri provides excellent dove hunting over harvested grain.",
    "Four Rivers CA and other MDC areas offer managed dove fields with draw-based public hunts."
  ],
  "Montana": [
    "Montana's dove hunting is concentrated in the eastern prairies and Yellowstone River valley.",
    "The grain fields near Miles City, Glendive, and Sidney attract September mourning dove concentrations.",
    "Montana's dove season opens September 1, with 15 birds per day allowed in the Central Flyway portion."
  ],
  "Nebraska": [
    "Nebraska's dove hunting is centered on the grain fields of the Platte River valley and Republican River corridor.",
    "The agricultural areas near Kearney and Grand Island produce excellent early September dove shooting.",
    "Nebraska allows 15 mourning doves per day during a season that runs from September through November."
  ],
  "Nevada": [
    "Nevada's dove hunting is concentrated in the agricultural areas near Fallon and the Lahontan Valley.",
    "The Humboldt and Carson River valleys provide the best mourning dove habitat in the state.",
    "Nevada's dove populations are supplemented by strong flights of white-winged doves moving up from the south."
  ],
  "New Hampshire": [
    "New Hampshire legalized mourning dove hunting in 2019, one of the last states to do so.",
    "Dove hunting opportunities are concentrated in the Connecticut River valley and southern lowlands.",
    "New Hampshire's dove season is short and low-pressure, with most birds found around backyard feeders and farms."
  ],
  "New Jersey": [
    "New Jersey's managed dove fields at Colliers Mills and other WMAs provide the state's best hunting.",
    "The agricultural areas of Salem and Cumberland counties in southern NJ attract the most doves.",
    "New Jersey's dove season runs from September through November with a 15-bird daily limit."
  ],
  "New Mexico": [
    "New Mexico offers both white-winged and mourning dove hunting, with strong flights through the Rio Grande valley.",
    "The Mesilla Valley near Las Cruces and the Pecos Valley near Carlsbad are top dove destinations.",
    "New Mexico's early September dove opener attracts hunters from across the Southwest to its agricultural valleys."
  ],
  "North Carolina": [
    "North Carolina's managed dove fields on game lands provide excellent September hunting statewide.",
    "The agricultural counties of the Piedmont and Coastal Plain produce the highest dove densities.",
    "Caswell, Chatham, and Lee counties in the central Piedmont are consistently top dove harvest areas."
  ],
  "North Dakota": [
    "North Dakota's dove hunting is centered on the grain fields and shelterbelts of the southeastern part of the state.",
    "The Drift Prairie and Red River Valley attract mourning doves that stage before their southward migration.",
    "North Dakota's dove season opens September 1 with a 15-bird limit in the Central Flyway."
  ],
  "Ohio": [
    "Ohio harvests over 500,000 doves annually, with the western agricultural counties leading production.",
    "Managed dove fields at Delaware and Grand River WMAs provide popular public hunting opportunities.",
    "The grain-belt counties of Darke, Mercer, and Auglaize are Ohio's most productive dove areas."
  ],
  "Oklahoma": [
    "Oklahoma is a top-3 state for dove harvest, with hunters taking over 2 million birds annually.",
    "The wheat stubble fields of central and southwestern Oklahoma attract enormous September dove flights.",
    "Oklahoma's September 1 dove opener is the most participated hunting event in the state."
  ],
  "Oregon": [
    "Oregon's dove hunting is concentrated in the agricultural valleys east of the Cascades.",
    "The Klamath Basin and Malheur County grain fields attract the state's largest dove concentrations.",
    "Oregon's Pacific Flyway dove limit is 15 per day during a season running September through October."
  ],
  "Pennsylvania": [
    "Pennsylvania's managed dove fields at state game lands provide the best public dove hunting in the Northeast.",
    "The agricultural counties of Lancaster, York, and Adams in southeastern PA produce the most doves.",
    "SGL 211 and SGL 205 are among Pennsylvania's most popular managed dove field destinations."
  ],
  "Rhode Island": [
    "Rhode Island's dove hunting is limited but available on state management areas and private farmland.",
    "The Arcadia Management Area in the western part of the state offers the best dove habitat.",
    "Rhode Island's dove season runs September through November with a 15-bird daily limit."
  ],
  "South Carolina": [
    "South Carolina's managed dove fields on plantation lands are a legendary Southern hunting tradition.",
    "The Midlands agricultural region from Orangeburg to Sumter produces the state's top dove hunting.",
    "South Carolina opens dove season September 1, with special shoots on WMAs drawing hundreds of hunters."
  ],
  "South Dakota": [
    "South Dakota's dove hunting is concentrated on grain fields of the James and Missouri River valleys.",
    "The southeastern counties near Sioux Falls and Yankton produce the state's highest dove densities.",
    "South Dakota's dove season opens September 1 with a 15-bird limit in the Central Flyway."
  ],
  "Tennessee": [
    "Tennessee's managed dove fields on WMAs like Forks of the River and Yanahli offer excellent public hunts.",
    "The agricultural counties of west Tennessee from Jackson to Memphis produce the highest dove harvest.",
    "Tennessee's September 1 dove opener is the most popular small game hunting day in the state."
  ],
  "Texas": [
    "Texas leads the nation in dove harvest, with hunters taking 5-7 million mourning and white-winged doves annually.",
    "The South Texas Brush Country and Rio Grande Valley host massive white-winged dove populations.",
    "Texas' special early white-winged dove season in the South Zone is a legendary September tradition."
  ],
  "Utah": [
    "Utah's dove hunting is centered on the agricultural areas of the Wasatch Front and Cache Valley.",
    "The fields near Brigham City and Logan attract mourning doves staging before their fall migration.",
    "Utah's dove season opens September 1 with a 15-bird limit in the Pacific Flyway."
  ],
  "Virginia": [
    "Virginia's managed dove fields on WMAs across the Piedmont and Valley provide top public hunting.",
    "The agricultural counties of the Shenandoah Valley and Southside produce the state's best dove hunting.",
    "Amelia WMA and Cavalier WMA host popular opening-day dove hunts with draw-based registration."
  ],
  "Washington": [
    "Washington's dove hunting is concentrated in the agricultural areas of the Columbia Basin.",
    "The Walla Walla Valley and Yakima Valley grain fields attract September mourning dove flights.",
    "Washington's dove season runs September 1 through October 30 with a 15-bird daily limit."
  ],
  "West Virginia": [
    "West Virginia's dove hunting is best in the eastern Panhandle's agricultural areas around Martinsburg.",
    "Managed dove fields at Shannondale and Sleepy Creek WMAs provide the state's best public hunting.",
    "West Virginia's mountainous terrain limits dove habitat, concentrating birds in the valley farmlands."
  ],
  "Wisconsin": [
    "Wisconsin's mourning dove season was re-established in 2003 after decades of protection.",
    "The agricultural areas of the southwestern Driftless Area produce the best dove hunting in the state.",
    "Dove populations in Wisconsin are concentrated in the southern and western counties along the Mississippi."
  ],
  "Wyoming": [
    "Wyoming's dove hunting is centered on the grain fields of the eastern plains and Bighorn Basin.",
    "The North Platte River valley near Torrington and Wheatland attracts the state's largest dove concentrations.",
    "Wyoming's dove season opens September 1, with most birds migrating south by mid-October."
  ],
};

export const stateFacts: Record<Species, Record<string, string[]>> = {
  all: {},
  duck: duckFacts,
  goose: gooseFacts,
  deer: deerFacts,
  turkey: turkeyFacts,
  dove: doveFacts,
};
