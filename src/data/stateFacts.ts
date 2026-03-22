import type { Species } from "./types";

const duckFacts: Record<string, string[]> = {
  "Alabama": [
    "The Mobile-Tensaw Delta is one of the most productive waterfowl staging areas in the Southeast.",
    "Alabama's Black Belt region attracts large flights of mallards and wood ducks during winter migration.",
    "Wheeler National Wildlife Refuge hosts thousands of wintering ducks annually."
  ],
  "Alaska": [
    "Alaska produces more ducks than any other state — over 12 million annually.",
    "The Yukon-Kuskokwim Delta is the largest wetland complex in North America.",
    "Emperor geese and spectacled eiders are unique species found in Alaska's flyways."
  ],
  "Arizona": [
    "The Lower Colorado River and Gila River valleys are Arizona's primary waterfowl migration corridors.",
    "Cibola NWR on the Arizona-California border hosts large concentrations of wintering pintails and wigeon.",
    "Arizona's desert reservoirs and stock tanks attract surprising numbers of teal, shovelers, and ring-necked ducks."
  ],
  "Arkansas": [
    "Stuttgart, AR sits at the heart of the Mississippi Flyway — one of the densest waterfowl staging areas in North America.",
    "Bayou Meto WMA provides critical winter habitat for mallard populations migrating through the Central Mississippi Valley.",
    "The Grand Prairie region of Arkansas draws massive flights from the Mississippi Flyway."
  ],
  "California": [
    "The Sacramento Valley is the winter home to millions of Pacific Flyway ducks.",
    "Sacramento NWR Complex is one of the most visited refuges in the nation for waterfowl observation and habitat.",
    "California's rice fields provide critical habitat for pintails, teal, and widgeon."
  ],
  "Colorado": [
    "The South Platte River corridor is a major migration staging area.",
    "Colorado's eastern plains host significant flights of mallards and teal.",
    "High altitude reservoirs support notable late-season diving duck populations."
  ],
  "Connecticut": [
    "The Connecticut River estuary is the largest tidal wetland complex in New England.",
    "Long Island Sound's coastal marshes attract significant flights of black ducks, bufflehead, and mergansers.",
    "The Great Meadows along the Connecticut River provide important staging habitat for wood ducks and teal."
  ],
  "Delaware": [
    "Bombay Hook NWR on Delaware Bay is one of the premier waterfowl concentration areas on the East Coast.",
    "Despite being the second-smallest state, Delaware's coastal marshes support massive concentrations of wintering waterfowl.",
    "The Delaware Bay shoreline is a critical Atlantic Flyway corridor for black ducks, pintails, and diving ducks."
  ],
  "Florida": [
    "Florida's mottled duck is a unique non-migratory species found year-round.",
    "Lake Okeechobee and the St. Johns River are premier waterfowl habitat areas.",
    "Florida is a key wintering ground for blue-winged and green-winged teal."
  ],
  "Georgia": [
    "The Altamaha River delta is Georgia's most significant waterfowl staging area.",
    "Georgia's coastal marshes attract significant numbers of wintering teal and pintails.",
    "Rum Creek WMA provides managed waterfowl habitat in central Georgia."
  ],
  "Hawaii": [
    "The endangered koloa maoli (Hawaiian duck) is the only endemic duck species in Hawaii and is fully protected.",
    "Hawaii's wetlands support migratory species like northern pintails and shovelers that winter on the islands.",
    "The wetlands of Kauai and the North Shore of Oahu provide the best waterfowl habitat in the Hawaiian Islands."
  ],
  "Idaho": [
    "The Snake River Plain hosts massive concentrations of mallards and wigeon.",
    "Market Lake WMA is one of Idaho's most important public waterfowl habitat areas.",
    "Idaho's mix of marsh, river, and reservoir habitat supports diverse waterfowl species."
  ],
  "Illinois": [
    "The Illinois River valley is one of the most important waterfowl corridors in North America.",
    "Chautauqua NWR regularly hosts over 500,000 ducks during peak migration.",
    "Illinois is a critical staging area for canvasbacks, mallards, and diving ducks."
  ],
  "Indiana": [
    "Hovey Lake FWA along the Ohio River is Indiana's premier waterfowl habitat area.",
    "The Wabash River bottoms provide important flooded timber habitat for wintering ducks.",
    "Indiana hosts strong flights of wood ducks, mallards, and teal each fall."
  ],
  "Iowa": [
    "Iowa's prairie potholes produce more ducks per acre than almost anywhere in the lower 48.",
    "The Missouri River corridor provides critical migration habitat.",
    "Riverton WMA and Forney Lake are key public waterfowl concentration areas."
  ],
  "Kansas": [
    "Cheyenne Bottoms is one of the most important shorebird and waterfowl wetlands in the Western Hemisphere.",
    "Quivira NWR hosts over 500,000 ducks during fall migration.",
    "Kansas sits at the crossroads of the Central Flyway with diverse species."
  ],
  "Kentucky": [
    "Ballard WMA's managed units support some of the densest waterfowl concentrations east of the Mississippi.",
    "Sloughs of the Ohio and Mississippi Rivers hold large concentrations of mallards.",
    "Kentucky Lake and Lake Barkley attract significant numbers of diving ducks."
  ],
  "Louisiana": [
    "Louisiana winters more ducks than any other state in the Mississippi Flyway.",
    "The coastal marshes south of I-10 are the epicenter of Gulf Coast waterfowl wintering habitat.",
    "Pintails, gadwall, and teal dominate Louisiana's wintering waterfowl populations."
  ],
  "Maine": [
    "Merrymeeting Bay is one of the most significant tidal waterfowl staging areas in the Northeast.",
    "Maine's rugged coastline supports important sea duck populations including eiders, scoters, and long-tailed ducks.",
    "The Scarborough Marsh and Weskeag Marsh are major waterfowl staging areas in southern Maine."
  ],
  "Maryland": [
    "The Chesapeake Bay is the Atlantic Flyway's most important wintering area for canvasbacks.",
    "Blackwater NWR on the Eastern Shore provides critical waterfowl wintering habitat.",
    "Maryland's layout boat traditions for observing diving ducks reflect the region's deep waterfowl heritage."
  ],
  "Massachusetts": [
    "The Parker River NWR on Plum Island is one of the most important waterfowl areas in New England.",
    "Cape Cod and the Islands support strong populations of sea ducks including eiders and scoters.",
    "The Great Marshes of Barnstable provide significant black duck and teal habitat along the Atlantic Flyway."
  ],
  "Michigan": [
    "Saginaw Bay is Michigan's most significant waterfowl concentration area.",
    "Michigan's Upper Peninsula offers remote, undisturbed waterfowl habitat.",
    "The state supports strong local populations of wood ducks and blue-winged teal."
  ],
  "Minnesota": [
    "Minnesota is the top duck-producing state in the lower 48.",
    "The prairie pothole region in western MN is the continent's 'duck factory.'",
    "Thief Lake WMA and Lac qui Parle are major Minnesota waterfowl staging areas."
  ],
  "Mississippi": [
    "The Mississippi Delta's flooded agriculture provides ideal mallard wintering habitat.",
    "Noxubee NWR and Yazoo NWR are premier public waterfowl habitat areas.",
    "The Batture lands along the Mississippi River support massive late-season waterfowl flights."
  ],
  "Missouri": [
    "Missouri's 'Grand Pass' region is one of the most historically significant waterfowl corridors in America.",
    "Duck Creek Conservation Area supports dense waterfowl concentrations during migration.",
    "The confluence of the Missouri and Mississippi Rivers creates a major migration bottleneck."
  ],
  "Montana": [
    "Freezout Lake hosts one of North America's largest tundra swan and snow goose staging areas.",
    "Montana's eastern prairies produce significant numbers of mallards and pintails.",
    "The Missouri River breaks provide remote and productive waterfowl habitat."
  ],
  "Nebraska": [
    "The Rainwater Basin is a critical spring and fall staging area for millions of waterfowl.",
    "The Platte River corridor is one of the Central Flyway's most important habitats.",
    "Nebraska's sandhill lakes support notable late-season diving duck populations."
  ],
  "New Hampshire": [
    "Great Bay estuary is New Hampshire's most significant waterfowl staging area and a critical Atlantic Flyway stopover.",
    "Lake Umbagog NWR on the Maine border provides excellent wood duck and black duck habitat in remote northern wetlands.",
    "The seacoast's tidal marshes around Hampton and Rye attract strong flights of black ducks, bufflehead, and mergansers."
  ],
  "New Jersey": [
    "The Edwin B. Forsythe NWR (Brigantine) is one of the most important Atlantic Flyway waterfowl refuges.",
    "New Jersey's Delaware Bay marshes host massive concentrations of black ducks, the highest densities on the East Coast.",
    "The Meadowlands and Great Swamp provide surprisingly productive waterfowl habitat within sight of the NYC skyline."
  ],
  "New Mexico": [
    "Bosque del Apache NWR along the Rio Grande hosts one of the most spectacular waterfowl concentrations in the Southwest.",
    "The Pecos River valley and playa lakes of eastern New Mexico are key Central Flyway staging areas for teal and pintails.",
    "New Mexico's high-desert reservoirs attract significant numbers of diving ducks including redheads and canvasbacks."
  ],
  "Nevada": [
    "Stillwater NWR near Fallon is one of the most important wetlands in the Great Basin.",
    "Ruby Lake NWR provides critical waterfowl habitat in Nevada's remote interior.",
    "The Lahontan Valley marshes host significant populations of redheads and canvasbacks."
  ],
  "New York": [
    "Long Island's Great South Bay is a major sea duck wintering area.",
    "The Finger Lakes region attracts large numbers of migrating diving ducks.",
    "Montezuma NWR is a premier stopover for Atlantic Flyway waterfowl."
  ],
  "North Carolina": [
    "The Outer Banks and Pamlico Sound are historic waterfowl wintering grounds.",
    "Mattamuskeet NWR hosts one of the largest concentrations of tundra swans on the East Coast.",
    "North Carolina's coastal marshes attract significant flights of teal and pintails."
  ],
  "North Dakota": [
    "North Dakota is the top duck-producing state in the U.S.",
    "Devils Lake and the prairie potholes are critical waterfowl production habitat.",
    "Over 2.5 million ducks are produced in ND each year."
  ],
  "Ohio": [
    "Lake Erie's marshes, especially Ottawa NWR, are Ohio's top waterfowl areas.",
    "Mosquito Creek and Killbuck Marsh attract strong flights of puddle ducks.",
    "Ohio sits at a critical junction of the Mississippi and Atlantic flyways."
  ],
  "Pennsylvania": [
    "Pymatuning Reservoir on the Ohio border is Pennsylvania's top waterfowl staging area with massive fall flights of diving ducks.",
    "Middle Creek WMA in Lebanon County hosts tens of thousands of snow geese and tundra swans each spring.",
    "Presque Isle State Park on Lake Erie provides important late-season habitat for canvasbacks, redheads, and scaup."
  ],
  "Oklahoma": [
    "Salt Plains NWR is a major Central Flyway staging area.",
    "Oklahoma's western playas attract significant numbers of green-winged teal.",
    "The Great Salt Plains host some of the highest waterfowl concentrations in the state."
  ],
  "Oregon": [
    "The Klamath Basin hosts one of the largest concentrations of waterfowl in North America.",
    "Summer Lake and Malheur NWR are premier Pacific Flyway waterfowl habitat areas.",
    "Oregon's Willamette Valley provides important habitat for pintails and wigeon."
  ],
  "Rhode Island": [
    "Narragansett Bay and the coastal salt ponds provide important sea duck and black duck habitat.",
    "The Great Swamp Management Area in South Kingstown is Rhode Island's top public waterfowl habitat area.",
    "Rhode Island's waterfowl season extends into early February, one of the latest in the Atlantic Flyway."
  ],
  "South Carolina": [
    "The ACE Basin is one of the largest undeveloped estuaries on the East Coast.",
    "South Carolina's managed tidal impoundments provide critical waterfowl wintering habitat.",
    "Santee Delta and the Waccamaw River support important wood duck and teal populations."
  ],
  "South Dakota": [
    "South Dakota's glacial lakes and prairie potholes produce massive duck flights.",
    "Sand Lake NWR is one of the most important waterfowl staging areas in the Central Flyway.",
    "The James River valley supports significant populations of mallards and gadwall."
  ],
  "Tennessee": [
    "Reelfoot Lake is one of the most significant waterfowl wintering areas in the country.",
    "The Tennessee NWR system provides over 51,000 acres of managed waterfowl habitat.",
    "West Tennessee's flooded timber offers classic bottomland hardwood waterfowl habitat."
  ],
  "Texas": [
    "The Texas Gulf Coast is the top wintering area for redheads in North America.",
    "Anahuac NWR and the rice prairies near El Campo are critical waterfowl wintering habitat.",
    "Texas supports one of the largest wintering waterfowl populations in the nation."
  ],
  "Utah": [
    "Bear River Migratory Bird Refuge is one of the most important wetlands in the West.",
    "The Great Salt Lake marshes host millions of ducks during fall migration.",
    "Utah's cinnamon teal population is one of the highest in the Pacific Flyway."
  ],
  "Vermont": [
    "Lake Champlain's Dead Creek WMA hosts large concentrations of snow geese and provides important waterfowl staging habitat.",
    "The Missisquoi NWR on Lake Champlain is Vermont's premier managed waterfowl habitat area.",
    "Vermont's beaver ponds and mountain streams support strong local populations of wood ducks and black ducks."
  ],
  "Virginia": [
    "Back Bay NWR provides critical habitat for Atlantic Flyway waterfowl.",
    "The Chesapeake Bay's Virginia shore is prime habitat for canvasbacks and redheads.",
    "Virginia's coastal marshes attract strong flights of black ducks and wigeon."
  ],
  "Washington": [
    "The Columbia Basin is Washington's top waterfowl production area.",
    "Puget Sound provides important sea duck wintering habitat.",
    "Ridgefield NWR along the Columbia River hosts large concentrations of wintering ducks."
  ],
  "West Virginia": [
    "The Ohio River floodplain and its backwater sloughs are West Virginia's primary waterfowl staging areas.",
    "McClintic WMA near Point Pleasant provides managed waterfowl habitat with flooded impoundments.",
    "West Virginia's mountain reservoirs attract late-season flights of ring-necked ducks, goldeneyes, and buffleheads."
  ],
  "Wisconsin": [
    "Horicon Marsh is the largest freshwater cattail marsh in the United States.",
    "The Mississippi River pools near La Crosse support significant diving duck populations.",
    "Wisconsin's northern forests produce strong flights of wood ducks and ring-necked ducks."
  ],
  "Wyoming": [
    "Ocean Lake and Boysen Reservoir in the Wind River Basin are Wyoming's most productive waterfowl areas.",
    "The North Platte River corridor near Casper attracts large flights of mallards, gadwall, and teal during migration.",
    "Wyoming spans both the Central and Pacific flyways, supporting diverse waterfowl populations from prairie potholes to mountain reservoirs."
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
    "Emperor geese are found almost exclusively in Alaska and are one of the rarest goose species in the world."
  ],
  "Arizona": [
    "The agricultural fields around Gila Bend and Buckeye attract wintering Canada geese and occasional snow geese.",
    "Arizona's portion of the Lower Colorado River provides important habitat for migrating and wintering geese.",
    "Cibola NWR on the Arizona-California border is a key Pacific Flyway stopover for geese heading to Mexico."
  ],
  "Arkansas": [
    "Arkansas lies in the heart of the Mississippi Flyway and hosts large flights of snow, blue, and white-fronted geese.",
    "The rice and soybean fields of the Grand Prairie attract massive concentrations of white-fronted geese.",
    "Bald Knob NWR and the Cache River bottoms provide critical goose habitat in northeastern Arkansas."
  ],
  "California": [
    "The Sacramento Valley hosts over 1 million geese each winter, including Ross's, snow, and white-fronted geese.",
    "California's Central Valley is the primary wintering ground for Pacific Flyway Aleutian cackling geese.",
    "Gray Lodge WMA near Gridley is one of the most important goose wintering areas in the Pacific Flyway."
  ],
  "Colorado": [
    "Colorado's Front Range urban areas host large resident Canada goose populations year-round.",
    "The San Luis Valley in southern Colorado attracts thousands of migrating snow geese and Canada geese each fall.",
    "Barr Lake and Union Reservoir along the Front Range are key staging areas for Colorado's goose migration."
  ],
  "Connecticut": [
    "Connecticut's resident Canada goose population has grown to over 30,000, a significant year-round presence.",
    "The Connecticut River floodplain from Hartford to the coast is the state's primary goose migration corridor.",
    "Barn Island WMA on the coast provides important goose staging habitat in southeastern Connecticut."
  ],
  "Delaware": [
    "Bombay Hook NWR hosts tens of thousands of snow geese each fall, one of the East Coast's major staging events.",
    "Delaware's position on the Delmarva Peninsula puts it at the center of the Atlantic Flyway's goose migration.",
    "The agricultural fields of Kent and Sussex counties attract large flocks of Canada geese from November through February."
  ],
  "Florida": [
    "Florida's goose populations are limited, but migratory Canada geese reach the northern panhandle in small numbers.",
    "Resident Canada geese have established breeding populations around Jacksonville and the northern tier of the state.",
    "Blue geese (dark-morph snow geese) occasionally appear in Florida's panhandle during severe northern winters."
  ],
  "Georgia": [
    "Georgia's piedmont region around Lake Oconee hosts a growing resident Canada goose population.",
    "The agricultural fields along the Savannah River floodplain attract migratory geese from the Atlantic Flyway.",
    "Altamaha WMA and surrounding coastal marshes support goose populations in southeast Georgia."
  ],
  "Idaho": [
    "The Snake River Plain between Idaho Falls and Twin Falls hosts massive concentrations of wintering Canada geese.",
    "Market Lake WMA is Idaho's most significant goose wintering area with managed fields.",
    "Idaho's Hagerman Valley along the Snake River attracts one of the densest wintering goose populations in the Pacific Flyway."
  ],
  "Illinois": [
    "The Horseshoe Lake area near Cairo was once the Canada goose capital of the continent, peaking at 500,000+ birds.",
    "Rend Lake and Union County are still major goose concentration areas in southern Illinois.",
    "Illinois' light goose conservation order targets overabundant snow and Ross's geese in spring."
  ],
  "Indiana": [
    "Jasper-Pulaski FWA is Indiana's most famous goose area, known for sandhill cranes and Canada geese.",
    "The Indiana Dunes area along Lake Michigan provides pass-through habitat for migrating geese.",
    "Goose Pond FWA in Greene County has become one of the top interior goose staging areas since its restoration."
  ],
  "Iowa": [
    "DeSoto NWR on the Missouri River hosts massive concentrations of snow geese during spring and fall migration.",
    "Iowa's snow goose conservation measures target overabundant populations damaging Arctic breeding habitat.",
    "Riverton WMA in Fremont County is Iowa's premier staging area for Canada and white-fronted geese."
  ],
  "Kansas": [
    "Quivira NWR near Stafford hosts hundreds of thousands of geese during peak fall migration.",
    "Cheyenne Bottoms and the surrounding grain fields attract massive flights of white-fronted and Canada geese.",
    "Kansas' light goose conservation order extends into April, targeting overabundant snow goose populations."
  ],
  "Kentucky": [
    "Ballard WMA at the confluence of the Ohio and Mississippi Rivers is Kentucky's premier goose staging area.",
    "Kentucky Lake and Lake Barkley attract large numbers of Canada geese from the upper Midwest.",
    "Peabody WMA's reclaimed mine lands in western Kentucky provide goose foraging habitat over grain fields."
  ],
  "Louisiana": [
    "Louisiana's coastal marshes and rice fields winter millions of snow, blue, and white-fronted geese.",
    "Lacassine NWR in Cameron Parish hosts some of the densest goose concentrations in the Mississippi Flyway.",
    "Louisiana's white-fronted goose wintering population is considered among the largest in North America."
  ],
  "Maine": [
    "Merrymeeting Bay is Maine's top goose staging area, where Canada geese concentrate during fall migration.",
    "Maine's early September season targets the growing local Canada goose population before migrants arrive.",
    "Scarborough Marsh and the Rachel Carson NWR provide coastal goose habitat along the Atlantic Flyway."
  ],
  "Maryland": [
    "Maryland's Eastern Shore is one of the most significant Canada goose wintering areas on the Atlantic Flyway, particularly Dorchester and Talbot counties.",
    "The Chesapeake Bay region historically wintered over 1 million Canada geese at its peak.",
    "Blackwater NWR and surrounding farm fields support some of the most concentrated goose populations on the East Coast."
  ],
  "Massachusetts": [
    "The Connecticut River valley from Springfield to Northampton is Massachusetts' primary goose migration corridor.",
    "Plum Island and the Parker River NWR attract flocks of Canada and snow geese along the coast.",
    "Massachusetts' resident Canada goose population exceeds 35,000, a significant year-round presence."
  ],
  "Michigan": [
    "Allegan State Game Area on the Kalamazoo River hosts one of the largest goose concentrations in the Great Lakes.",
    "Michigan's Saginaw Bay region attracts large numbers of Canada geese that forage on harvested sugar beet and corn fields.",
    "The Muskegon County Wastewater facility has become a major goose staging area, drawing thousands of Canadas each fall."
  ],
  "Minnesota": [
    "Minnesota's Lac qui Parle WMA was the original Canada goose restoration site and remains a premier staging area.",
    "The Rochester area hosts one of the largest wintering Canada goose populations in the state, numbering over 30,000.",
    "Minnesota's light goose conservation order targets spring-migrating snow geese that are damaging Arctic breeding habitat."
  ],
  "Mississippi": [
    "The Yazoo-Mississippi Delta's agricultural fields attract substantial flights of snow and white-fronted geese.",
    "Noxubee NWR in Noxubee County is Mississippi's most reliable public-access goose habitat area.",
    "Mississippi's goose populations have increased steadily as snow goose numbers push into the Deep South."
  ],
  "Missouri": [
    "Swan Lake NWR in north-central Missouri hosts over 100,000 Canada geese at peak migration.",
    "Squaw Creek (Loess Bluffs) NWR attracts hundreds of thousands of snow geese each spring and fall.",
    "Missouri's managed waterfowl areas around Fountain Grove and Grand Pass support some of the Midwest's densest Canada goose staging."
  ],
  "Montana": [
    "Freezout Lake near Choteau hosts over 300,000 snow geese during spring migration, one of the greatest spectacles in the West.",
    "Montana's Hi-Line region along the Milk River corridor supports important Canada goose populations over grain stubble.",
    "Canyon Ferry Reservoir near Helena is a key staging area for fall-migrating Canada and snow geese."
  ],
  "Nebraska": [
    "The Rainwater Basin hosts millions of snow geese during spring migration, a major conservation focus area.",
    "The Platte River corridor near Kearney attracts massive flocks of white-fronted geese alongside sandhill cranes.",
    "Nebraska's dark goose (Canada and white-fronted) populations rank among the densest in the Central Flyway."
  ],
  "Nevada": [
    "Ruby Lake NWR in northeast Nevada is the state's most significant goose staging area with Canada and snow geese.",
    "Stillwater NWR near Fallon attracts migrating snow geese and Ross's geese through the Pacific Flyway.",
    "The Lahontan Valley agricultural fields near Fallon support Canada goose foraging habitat."
  ],
  "New Hampshire": [
    "Great Bay estuary near Durham is New Hampshire's most productive goose staging area during fall migration.",
    "New Hampshire's early September season targets resident Canada geese, which have become abundant in the Merrimack Valley.",
    "Lake Umbagog NWR on the Maine border provides remote, low-disturbance goose habitat in the North Country."
  ],
  "New Jersey": [
    "New Jersey's resident Canada goose population exceeds 100,000, one of the highest densities in the Atlantic Flyway.",
    "The Delaware Bay marshes and surrounding grain fields attract large flocks of migratory snow geese.",
    "Edwin B. Forsythe NWR (Brigantine) is a major staging area for Atlantic brant along the Jersey Shore."
  ],
  "New Mexico": [
    "Bosque del Apache NWR on the Rio Grande is the Southwest's most iconic goose wintering area with over 30,000 snow geese.",
    "The Pecos Valley and Bitter Lake NWR provide important goose wintering habitat in eastern New Mexico.",
    "New Mexico's light goose conservation order targets overabundant snow goose populations in spring."
  ],
  "New York": [
    "The Finger Lakes region is New York's top goose staging area, with large flights of Canada geese over harvested corn fields.",
    "Jamaica Bay NWR in New York City hosts thousands of Atlantic brant and is a critical urban wildlife area.",
    "Montezuma NWR near Seneca Falls is a major staging area for Canada and snow geese on the Atlantic Flyway."
  ],
  "North Carolina": [
    "The Outer Banks and Pamlico Sound host the largest wintering population of Atlantic brant south of New Jersey.",
    "Mattamuskeet NWR is North Carolina's premier goose staging area with tundra swans and Canada geese.",
    "Pea Island NWR on the Outer Banks is a critical stopover for snow geese moving along the Atlantic coast."
  ],
  "North Dakota": [
    "North Dakota's prairie potholes produce more Canada geese than nearly any other region in the lower 48.",
    "Devils Lake and the Souris River valley host massive fall concentrations of snow, Canada, and white-fronted geese.",
    "The spring light goose conservation order in North Dakota targets overabundant populations among the most productive in the country."
  ],
  "Ohio": [
    "Ottawa NWR on Lake Erie is Ohio's top goose staging area, with massive flights of Canada geese.",
    "The Killbuck Marsh area in Wayne County provides important goose habitat in the interior.",
    "Ohio's growing resident Canada goose population provides year-round goose presence from September through winter."
  ],
  "Oklahoma": [
    "Salt Plains NWR near Cherokee hosts tens of thousands of Canada and snow geese during fall migration.",
    "Oklahoma's Red River valley supports goose populations over wheat fields, a regional pattern in the southern Central Flyway.",
    "Washita NWR near Butler is a reliable wintering area for Canada geese in southwestern Oklahoma."
  ],
  "Oregon": [
    "The Klamath Basin hosts one of the largest wintering populations of white-fronted geese in the Pacific Flyway.",
    "Sauvie Island WMA near Portland is Oregon's most popular goose staging area with Canada and cackling geese.",
    "Summer Lake WMA in Lake County provides remote goose habitat over flooded meadows in high-desert country."
  ],
  "Pennsylvania": [
    "Middle Creek WMA in Lebanon County hosts over 100,000 snow geese each spring, Pennsylvania's greatest wildlife spectacle.",
    "Pymatuning Reservoir attracts large numbers of Canada geese that forage on surrounding dairy farm fields.",
    "Pennsylvania's resident Canada goose population exceeds 250,000, supporting one of the densest year-round populations in the East."
  ],
  "Rhode Island": [
    "Ninigret NWR and the coastal salt ponds attract Atlantic brant and Canada geese during fall migration.",
    "Rhode Island's resident Canada goose population supports an early September season before regular waterfowl dates.",
    "The Great Swamp Management Area in South Kingstown is the state's most significant goose staging area."
  ],
  "South Carolina": [
    "The ACE Basin's managed impoundments attract Canada geese and occasional snow geese to the coast.",
    "South Carolina's piedmont farm country around Abbeville and Laurens hosts growing Canada goose populations.",
    "Santee NWR near Summerton provides managed goose habitat in the central part of the state."
  ],
  "South Dakota": [
    "Sand Lake NWR near Aberdeen hosts hundreds of thousands of snow geese during fall migration.",
    "The Missouri River corridor, especially near Pierre, attracts massive flights of Canada and snow geese.",
    "South Dakota's spring light goose conservation order is one of the most active in the Central Flyway."
  ],
  "Tennessee": [
    "Cross Creeks NWR on the Cumberland River near Dover is Tennessee's premier Canada goose staging area.",
    "Tennessee NWR near Paris attracts thousands of Canada geese to its managed agricultural fields.",
    "The Tennessee Valley's grain fields between Camden and Waverly support significant late-season goose populations."
  ],
  "Texas": [
    "Texas winters more snow geese than any other state, with over 1 million along the Gulf Coast.",
    "The rice prairies near El Campo and Eagle Lake are critical white-fronted (specklebelly) goose wintering habitat.",
    "The Texas Panhandle's playa lakes attract massive flights of Canada, snow, and white-fronted geese from the Central Flyway."
  ],
  "Utah": [
    "Bear River MBR hosts thousands of Canada geese and is Utah's premier goose staging area.",
    "The Cache Valley in northern Utah attracts large flocks of snow geese during spring migration.",
    "Farmington Bay WMA on the Great Salt Lake provides field and marsh goose habitat along the Pacific Flyway."
  ],
  "Vermont": [
    "Dead Creek WMA near Addison hosts thousands of snow geese each fall, Vermont's most iconic wildlife event.",
    "Missisquoi NWR on Lake Champlain is Vermont's primary managed goose habitat area.",
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
    "The Columbia Basin's agricultural fields near Moses Lake support important Canada goose wintering habitat."
  ],
  "West Virginia": [
    "The Ohio River valley in the Northern Panhandle is West Virginia's most productive goose staging corridor.",
    "McClintic WMA near Point Pleasant provides managed goose habitat over agricultural fields and impoundments.",
    "West Virginia's resident Canada goose population has expanded from urban areas into rural farmland across the state."
  ],
  "Wisconsin": [
    "Horicon NWR in Dodge County hosts over 200,000 Canada geese at peak fall migration.",
    "The Mississippi River corridor near La Crosse attracts large flights of snow and Canada geese.",
    "Wisconsin's early September season targets resident Canada geese before the main migratory flights arrive."
  ],
  "Wyoming": [
    "Seedskadee NWR along the Green River is Wyoming's most reliable goose staging area.",
    "The Bighorn Basin near Lovell and Greybull attracts wintering Canada geese that forage on irrigated grain fields.",
    "Ocean Lake near Riverton hosts both Canada and snow geese during fall migration through the Central Flyway."
  ],
};

const deerFacts: Record<string, string[]> = {
  "Alabama": [
    "Alabama supports one of the largest white-tailed deer populations in the Southeast, with over 1.5 million animals.",
    "The Black Belt region produces mature whitetails with substantial antler growth due to rich calcium soils.",
    "Alabama's deer management season runs from mid-October to early February, one of the longest in the nation."
  ],
  "Alaska": [
    "Alaska's Sitka blacktail deer inhabit the coastal rainforests of Southeast Alaska and Kodiak Island.",
    "Kodiak Island is the most significant Sitka blacktail habitat, supporting dense deer populations.",
    "Alaska has no whitetail or mule deer — Sitka blacktails are the only deer species in the state."
  ],
  "Arizona": [
    "Arizona's Coues whitetail deer, found in the southern mountains, is one of the most elusive subspecies in North America.",
    "The Kaibab Plateau north of the Grand Canyon supports significant mule deer populations.",
    "Arizona uses a draw system for most deer management units, with some units having less than 5% permit allocation rates."
  ],
  "Arkansas": [
    "Arkansas supports over 1 million white-tailed deer across diverse habitats from the Ozarks to the Delta.",
    "The Ozark National Forest provides vast public land with productive whitetail habitat.",
    "Arkansas manages deer through multiple regulated seasons across separate management periods."
  ],
  "California": [
    "California has the largest mule deer population of any state, with an estimated 450,000 animals.",
    "Zone X in Lassen and Modoc counties is California's most significant mule deer habitat zone.",
    "California's blacktail deer in the Coast Range and Cascades are a subspecies unique to the Pacific Coast."
  ],
  "Colorado": [
    "Colorado holds the largest mule deer population in the nation at over 400,000 animals.",
    "Units 61 and 62 on the Uncompahgre Plateau support some of the state's most mature mule deer populations.",
    "Colorado's late November management season coincides with the mule deer rut, when mature bucks are most active."
  ],
  "Connecticut": [
    "Connecticut's deer density exceeds 30 per square mile in some areas, among the highest in New England.",
    "Fairfield County in southwestern CT consistently supports the state's densest whitetail populations.",
    "Connecticut's deer management program includes extended archery periods, expanding population control capacity."
  ],
  "Delaware": [
    "Despite its small size, Delaware manages over 12,000 deer annually from a dense population.",
    "Sussex County in southern Delaware supports the majority of the state's mature whitetail populations.",
    "Delaware restricts firearm deer management to shotguns only — no centerfire rifles are permitted."
  ],
  "Florida": [
    "Florida has three deer subspecies: the Osceola, the Virginia whitetail, and the diminutive Key deer (protected).",
    "Eglin Air Force Base in the Panhandle offers some of Florida's most extensive deer habitat at over 460,000 acres.",
    "Florida's deer management season can start as early as July in some zones, the earliest in the country."
  ],
  "Georgia": [
    "Georgia manages approximately 350,000 deer per season, ranking in the top 5 nationally.",
    "Dooly and Hancock counties in central Georgia consistently support mature whitetail populations with substantial antler growth.",
    "Georgia permits baiting for deer management in most counties, a practice prohibited in many other states."
  ],
  "Hawaii": [
    "Hawaii supports axis deer on Maui, Molokai, and Lanai — an exotic species introduced in 1868.",
    "Lanai was once known as the 'Pineapple Island' but now has more axis deer than any other Hawaiian island.",
    "Hawaii's axis deer have no natural predators and cause significant agricultural and ecological impact, requiring active management."
  ],
  "Idaho": [
    "Idaho supports mule deer, whitetail, and Coeur d'Alene whitetails in the panhandle's dense forests.",
    "The Clearwater Region (Units 10-17) supports notable whitetail populations in the river breaks.",
    "Idaho's general season tags are available over-the-counter, making it one of the most accessible western states for deer observation."
  ],
  "Illinois": [
    "Illinois is a top-5 state for mature whitetails, with Pike County supporting some of the largest-bodied deer in the Midwest.",
    "Illinois restricts deer management to shotgun, muzzleloader, and archery — no centerfire rifles are permitted.",
    "The Golden Triangle of Pike, Adams, and Brown counties supports some of the densest mature whitetail populations in the Midwest."
  ],
  "Indiana": [
    "Indiana manages over 120,000 deer annually, with Parke and Brown counties being top producers.",
    "Indiana permits rifles for deer management only in specific counties — most of the state is restricted to other methods.",
    "The southern Indiana hills and creek bottoms support the state's most substantial whitetail populations."
  ],
  "Iowa": [
    "Iowa is widely considered the top state for mature whitetails, with more large-bodied deer per square mile than anywhere.",
    "Iowa's conservative management limits keep pressure low and buck age structure high.",
    "Allamakee, Clayton, and Winneshiek counties in northeast Iowa consistently support the densest mature buck populations."
  ],
  "Kansas": [
    "Kansas ranks in the top 3 for mature whitetails, rivaling Iowa and Illinois in antler quality.",
    "The Flint Hills region's mix of tallgrass prairie and creek timber produces substantial whitetail populations.",
    "Kansas limits buck harvest to one per season, maintaining older age classes in the herd."
  ],
  "Kentucky": [
    "Kentucky manages over 130,000 deer annually and supports multiple world-class whitetail populations.",
    "The Land Between the Lakes NRA offers 170,000 acres of public land deer habitat in western Kentucky.",
    "Kentucky's deer management season opens in early September, one of the earliest in the East."
  ],
  "Louisiana": [
    "Louisiana's deer population exceeds 1 million, concentrated in the piney woods and bottomland hardwoods.",
    "The Atchafalaya Basin and surrounding areas support some of the heaviest-bodied whitetails in the South.",
    "Louisiana permits dog-assisted deer management in certain parishes, a traditional practice dating back centuries."
  ],
  "Maine": [
    "Maine's North Woods hold the largest whitetail deer in New England, with bucks commonly exceeding 200 lbs.",
    "Aroostook and Penobscot counties in northern Maine support the state's most substantial deer populations.",
    "Maine's deer management program permits statewide rifle use, a tradition since territorial days."
  ],
  "Maryland": [
    "Maryland's deer density exceeds 40 per square mile in parts of the Western Shore, among the highest in the East.",
    "The agricultural counties of Frederick, Washington, and Carroll support mature whitetail populations year after year.",
    "Maryland manages deer through controlled programs at installations like Aberdeen Proving Ground with exceptional population quality."
  ],
  "Massachusetts": [
    "Massachusetts' deer population has grown to over 95,000, concentrated on Cape Cod and in the Connecticut Valley.",
    "Nantucket Island has an extremely dense deer herd requiring extended seasons to manage the population.",
    "The Quabbin Reservoir in central MA provides controlled access to some of the state's best whitetail habitat."
  ],
  "Michigan": [
    "Michigan has over 1.5 million deer and issues more deer licenses than any state except Texas.",
    "The Upper Peninsula offers vast public land and mature bucks in a wilderness setting.",
    "Michigan's November 15 deer management season opener is an unofficial state holiday, with over 600,000 participants afield."
  ],
  "Minnesota": [
    "Minnesota manages over 200,000 deer annually from a herd of approximately 1 million whitetails.",
    "The bluff country of southeastern Minnesota (Houston, Fillmore counties) supports the state's densest mature buck populations.",
    "Minnesota's CWD management zones in the southeast have created new regulations for carcass transport and testing."
  ],
  "Mississippi": [
    "Mississippi's deer herd exceeds 1.5 million, one of the largest per-capita populations in the country.",
    "The Delta region's fertile agricultural land grows whitetails with wide, heavy antlers.",
    "Mississippi permits up to 5 bucks per management season on private land in some zones, reflecting the dense population."
  ],
  "Missouri": [
    "Missouri is a top-10 whitetail state, with Pike, Macon, and Mercer counties leading in mature deer density.",
    "The Mark Twain National Forest provides over 1.5 million acres of public deer habitat in the Ozarks.",
    "Missouri's November management season typically results in over 100,000 deer harvested in just 11 days."
  ],
  "Montana": [
    "Montana supports both mule deer and whitetail populations, with the Breaks country producing giant muleys.",
    "The Missouri River Breaks have produced some of the largest typical mule deer recorded in North America.",
    "Montana's general deer tag covers both species and is available over-the-counter for residents."
  ],
  "Nebraska": [
    "Nebraska's Pine Ridge and Wildcat Hills in the northwest panhandle support notable mule deer populations.",
    "The Republican River valley in southwest Nebraska is known for large whitetails in the creek-bottom timber.",
    "Nebraska offers over-the-counter rifle tags for both mule deer and whitetails in many units."
  ],
  "Nevada": [
    "Nevada's mule deer thrive in the high desert mountain ranges, with some populations producing impressive antler growth.",
    "The Ruby Mountains near Elko are Nevada's most significant mule deer habitat.",
    "Nevada's tag system is draw-only, with some premium units requiring 10+ bonus points to draw."
  ],
  "New Hampshire": [
    "New Hampshire's deer herd has grown to over 100,000, with the Merrimack Valley being the densest region.",
    "Hillsborough and Rockingham counties in southern NH consistently support the state's most substantial whitetail populations.",
    "New Hampshire's management season extends through December, offering late-season deer activity monitoring opportunities."
  ],
  "New Jersey": [
    "New Jersey has one of the highest deer densities in the nation at over 40 per square mile in some areas.",
    "Hunterdon and Warren counties in northwest NJ are the top whitetail producers in the state.",
    "New Jersey's six-day management season with shotgun-only rules creates concentrated deer population control activity."
  ],
  "New Mexico": [
    "New Mexico supports mule deer, Coues whitetail, and free-range elk populations, sometimes in overlapping habitat.",
    "The Gila National Forest in southwest NM supports Coues whitetails in rugged canyon country.",
    "New Mexico's Unit 2B near Chama is one of the most coveted mule deer management areas in the West."
  ],
  "New York": [
    "New York manages over 200,000 deer annually, with the Southern Tier and Adirondacks being top regions.",
    "The Catskill Mountains and surrounding counties (Delaware, Sullivan, Orange) support big-bodied whitetails.",
    "New York City's Staten Island has a controlled archery program to manage its suburban deer herd."
  ],
  "North Carolina": [
    "North Carolina's coastal plain supports the state's largest whitetails, with Tyrrell and Hyde counties leading.",
    "The Uwharrie National Forest in the Piedmont offers quality public land whitetail habitat.",
    "North Carolina allows the use of dogs for deer drives in the coastal plain, a longstanding tradition."
  ],
  "North Dakota": [
    "North Dakota's badlands in the western part of the state support mature mule deer populations.",
    "The Theodore Roosevelt National Park area is surrounded by prime mule deer habitat in the Little Missouri breaks.",
    "North Dakota's whitetail populations have expanded along the river valleys and shelterbelts of the eastern prairie."
  ],
  "Ohio": [
    "Ohio ranks in the top 5 nationally for mature whitetails and is a premier archery destination.",
    "The southeastern hill country (Guernsey, Tuscarawas, Coshocton counties) consistently supports the densest buck populations.",
    "Ohio restricts deer management to shotgun and muzzleloader — no centerfire rifles — contributing to higher buck survival."
  ],
  "Oklahoma": [
    "Oklahoma supports both whitetail and mule deer, with the Wichita Mountains providing a unique crossover zone.",
    "The southeastern counties of Pushmataha and LeFlore support Oklahoma's most substantial whitetail populations.",
    "Oklahoma's generous six-deer harvest limit (multiple bucks allowed) is one of the most liberal management programs in the country."
  ],
  "Oregon": [
    "Oregon supports blacktail deer on the west side and mule deer on the east side of the Cascades.",
    "The Steens Mountain and Hart Mountain areas in southeast Oregon support notable Rocky Mountain mule deer populations.",
    "Oregon's Roosevelt elk country in the Coast Range also holds excellent blacktail deer habitat."
  ],
  "Pennsylvania": [
    "Pennsylvania has one of the largest deer herds in the East at over 1.5 million animals.",
    "The north-central counties (Potter, Tioga, Clinton) are the heart of Pennsylvania's Big Woods deer tradition.",
    "Pennsylvania's concurrent antlerless season allows simultaneous doe population management."
  ],
  "Rhode Island": [
    "Rhode Island's deer population exceeds 18,000, high density for the smallest state in the nation.",
    "The Arcadia Management Area in the western part of the state offers the best public deer habitat.",
    "Rhode Island's extended archery management period increases population control capacity in this densely settled state."
  ],
  "South Carolina": [
    "South Carolina's deer management season runs August through January, one of the longest continuous seasons in the country.",
    "The Lowcountry's ACE Basin and Santee Delta support heavy-bodied whitetails with unique antler characteristics.",
    "South Carolina permits dog-assisted deer management in many counties, a traditional practice in the Southeast."
  ],
  "South Dakota": [
    "South Dakota's Black Hills support notable mule deer populations, while the Missouri River breaks hold significant whitetails.",
    "Gregory and Charles Mix counties along the Missouri are consistently top whitetail production areas.",
    "South Dakota's West River mule deer tags are available over-the-counter for residents in most units."
  ],
  "Tennessee": [
    "Tennessee manages over 150,000 deer annually, with the western part of the state producing the most.",
    "The Land Between the Lakes NRA offers some of the best public land deer habitat in the Southeast.",
    "Fayette and Hardeman counties in western Tennessee consistently support mature whitetail populations."
  ],
  "Texas": [
    "Texas has the largest deer herd in the country at over 5 million whitetails and mule deer.",
    "The South Texas Brush Country supports the most substantial whitetail populations in the state.",
    "The Hill Country has the highest deer density in the nation, but smaller body and antler size due to habitat pressure."
  ],
  "Utah": [
    "Utah's mule deer population is concentrated on the Wasatch Front and high plateaus of the central mountains.",
    "The Henry Mountains and Paunsaugunt units are Utah's most coveted limited-entry mule deer management areas.",
    "Utah introduced the dedicated program, requiring 40 hours of conservation service for a 3-year general tag."
  ],
  "Vermont": [
    "Vermont's Green Mountains and Northeast Kingdom provide classic New England deer habitat.",
    "Bennington and Windham counties in southern Vermont support the state's largest whitetail populations.",
    "Vermont's November deer management season is a deeply ingrained cultural tradition, with opening day treated as an unofficial holiday."
  ],
  "Virginia": [
    "Virginia manages over 200,000 deer annually, with the Shenandoah Valley being the most productive region.",
    "Rappahannock and Fauquier counties in the Piedmont consistently support Virginia's densest whitetail populations.",
    "Virginia permits Sunday deer management activity on private land and select public lands, expanded in recent years."
  ],
  "Washington": [
    "Washington supports blacktail on the west side, mule deer in the east, and whitetails in the northeast corner.",
    "The Blue Mountains in southeast Washington support the state's most notable mule deer populations.",
    "Washington's Methow Valley and Okanogan region provide premier mule deer habitat in the North Cascades."
  ],
  "West Virginia": [
    "West Virginia manages over 100,000 deer annually from its mountainous terrain and deep hollows.",
    "Hampshire, Hardy, and Grant counties in the Eastern Panhandle support the state's densest whitetail populations.",
    "West Virginia's buck-only management season in November is followed by an antlerless-only season in December."
  ],
  "Wisconsin": [
    "Wisconsin's 9-day deer management season is a cultural phenomenon, with over 600,000 participants taking to the woods.",
    "Buffalo and Trempealeau counties in the Driftless Area consistently support the state's densest mature buck populations.",
    "Wisconsin's CWD management in the southern farmland zone has created intensive management regulations since 2002."
  ],
  "Wyoming": [
    "Wyoming supports mule deer and whitetail populations across diverse terrain from prairie to alpine.",
    "The Wyoming Range and Salt River Range in the western part of the state support notable mule deer populations.",
    "Wyoming's general deer tags are available over-the-counter for residents, covering vast public land."
  ],
};

const turkeyFacts: Record<string, string[]> = {
  "Alabama": [
    "Alabama's Black Belt and Tombigbee River corridor support some of the densest wild turkey populations in the Southeast.",
    "Alabama was a key state in the wild turkey restoration that brought the species back from near-extinction.",
    "Lowndes and Marengo counties in the Black Belt consistently support some of the strongest gobbler populations in the South."
  ],
  "Arizona": [
    "Arizona supports Merriam's wild turkeys in the ponderosa pine forests of the Mogollon Rim.",
    "The Kaibab National Forest north of Flagstaff is Arizona's top Merriam's turkey habitat area.",
    "Arizona's Gould's turkey in the extreme southeast is one of the rarest subspecies in the U.S."
  ],
  "Arkansas": [
    "Arkansas has one of the strongest turkey populations in the nation at over 200,000 birds.",
    "The Ozark National Forest provides vast public land turkey habitat.",
    "Pope and Yell counties in the Arkansas River Valley are consistently top turkey population areas."
  ],
  "California": [
    "California's Rio Grande and hybrid turkeys thrive in the oak woodlands of the Central Coast and Sierra foothills.",
    "Tehama and Shasta counties in northern California support excellent turkey habitat on public land.",
    "California has both spring and fall turkey seasons, with the fall season allowing either-sex management."
  ],
  "Colorado": [
    "Colorado's Merriam's turkeys inhabit the ponderosa pine forests along the Front Range and in the San Juans.",
    "Rio Grande turkeys thrive along the eastern Colorado river valleys and the Arkansas River corridor.",
    "The Spanish Peaks area near Trinidad supports both Merriam's and Rio Grande subspecies."
  ],
  "Connecticut": [
    "Connecticut's wild turkey population has grown from 0 to over 30,000 since reintroduction in the 1970s.",
    "Litchfield County in the northwest hills is Connecticut's best spring gobbler habitat region.",
    "Connecticut's fall turkey season allows either-sex management to control the growing population."
  ],
  "Delaware": [
    "Delaware's turkey population has rebounded to over 3,000 birds, concentrated in Kent and Sussex counties.",
    "The Blackbird State Forest and surrounding agricultural land provide the state's best turkey habitat.",
    "Delaware's spring turkey management season is limited to a 2-bird limit with shotgun-only regulations."
  ],
  "Florida": [
    "Florida's Osceola turkey is a unique subspecies found nowhere else in the world.",
    "The Osceola turkey is a bucket-list species for serious turkey observers, found only in peninsular Florida.",
    "Osceola National Forest and the Green Swamp are premier public land Osceola turkey habitat areas."
  ],
  "Georgia": [
    "Georgia has one of the largest turkey populations in the Southeast at over 300,000 birds.",
    "The Chattahoochee National Forest in the north Georgia mountains provides excellent turkey habitat.",
    "Talbot and Harris counties in the Piedmont are consistently top turkey population areas."
  ],
  "Hawaii": [
    "Hawaii has introduced Rio Grande wild turkeys on the Big Island, Maui, and Molokai.",
    "The Parker Ranch area on the Big Island supports some of Hawaii's best turkey habitat.",
    "Hawaii has both spring and fall turkey seasons with liberal limits to manage the non-native populations."
  ],
  "Idaho": [
    "Idaho's Merriam's turkeys thrive in the pine forests of the central mountains and Clearwater region.",
    "The Salmon River and Middle Fork country support turkey populations in true wilderness settings.",
    "Idaho allows over-the-counter spring turkey tags, making it one of the most accessible western turkey states."
  ],
  "Illinois": [
    "Illinois has one of the most successful turkey restoration stories, growing from 0 to over 150,000 birds.",
    "The Shawnee National Forest in southern Illinois is the state's top public land turkey habitat area.",
    "Jo Daviess and Calhoun counties along the Mississippi River support consistently high gobbler populations."
  ],
  "Indiana": [
    "Indiana's turkey population exceeds 100,000, with the southern hills being the most productive region.",
    "Brown County and the surrounding Hoosier National Forest provide excellent spring turkey habitat on public land.",
    "Indiana's spring season opens in late April, timed to coincide with peak gobbling activity."
  ],
  "Iowa": [
    "Iowa's eastern timber counties consistently support mature gobblers with long beards and heavy spurs.",
    "Shimek State Forest and Stephens State Forest in southeast Iowa are top public turkey habitat areas.",
    "Iowa's fall season allows either-sex management and includes an additional archery-only option."
  ],
  "Kansas": [
    "Kansas has all four major subspecies of wild turkey: Eastern, Rio Grande, Merriam's, and hybrids.",
    "The Red Hills and Gyp Hills of south-central Kansas are significant Rio Grande turkey country.",
    "Kansas allows 2 bearded turkeys per spring season on a single tag."
  ],
  "Kentucky": [
    "Kentucky's Land Between the Lakes NRA provides outstanding public land turkey habitat on 170,000 acres.",
    "Kentucky's turkey population has recovered to over 200,000 birds from near-extinction in the mid-1900s.",
    "Wayne and McCreary counties in southeastern Kentucky are consistently top spring population areas."
  ],
  "Louisiana": [
    "Louisiana's bottomland hardwoods along the Mississippi River provide unique turkey habitat in flooded timber transitions.",
    "Kisatchie National Forest's longleaf pine ecosystem supports healthy turkey populations in central Louisiana.",
    "Louisiana's spring season is one of the earliest in the Southeast, opening in late March in some zones."
  ],
  "Maine": [
    "Maine's turkey population has grown from 0 to over 60,000 since reintroduction in the 1970s.",
    "York and Oxford counties in southwestern Maine consistently support the most substantial gobbler populations.",
    "Maine allows both spring (bearded only) and fall (either-sex) turkey seasons with separate permits."
  ],
  "Maryland": [
    "Maryland's western counties (Garrett, Allegany, Washington) are the state's best spring turkey habitat areas.",
    "Green Ridge State Forest in Allegany County offers over 46,000 acres of public turkey habitat.",
    "Maryland's spring turkey season has a 2-bird limit, among the most generous in the Mid-Atlantic."
  ],
  "Massachusetts": [
    "Massachusetts' turkey population has grown explosively, now exceeding 25,000 birds from 37 released in 1972.",
    "The Berkshires and Connecticut River Valley in western MA support the best gobbler populations.",
    "Massachusetts turkeys have adapted to suburban environments, with significant populations near major metro areas."
  ],
  "Michigan": [
    "Michigan's turkey population exceeds 200,000, with the southwestern Lower Peninsula being the most productive.",
    "Allegan and Ionia counties consistently lead Michigan in spring turkey population density.",
    "Michigan offers a youth weekend before the regular spring season to introduce new participants to the species."
  ],
  "Minnesota": [
    "Minnesota's southeast bluff country along the Mississippi River is the state's premier turkey habitat region.",
    "Houston and Fillmore counties in the Driftless Area support the heaviest gobblers in the state.",
    "Minnesota's fall season is limited to specific permit areas in the southern and central parts of the state."
  ],
  "Mississippi": [
    "Mississippi's Tombigbee National Forest and Black Belt prairies are prime turkey habitat.",
    "Kemper and Noxubee counties in east-central Mississippi are consistently top gobbler population areas.",
    "Mississippi's spring season runs 44 days, one of the longest in the Southeast."
  ],
  "Missouri": [
    "Missouri pioneered modern wild turkey management and helped supply birds for reintroduction across the nation.",
    "The Ozarks region holds the state's highest turkey densities in mature oak-hickory forests.",
    "Shannon and Texas counties in the southern Ozarks are significant Missouri gobbler habitat areas."
  ],
  "Montana": [
    "Montana's Merriam's turkeys inhabit the ponderosa pine forests of the southeastern part of the state.",
    "The Long Pines and Short Pines areas near Ekalaka are Montana's top turkey habitat areas.",
    "Montana allows over-the-counter spring tags in some districts, with fall tags available by draw."
  ],
  "Nebraska": [
    "Nebraska has both Merriam's and Rio Grande turkeys, with Eastern turkeys in the southeast river bottoms.",
    "The Pine Ridge in northwestern Nebraska is the state's best Merriam's turkey habitat.",
    "Nebraska's Niobrara River corridor supports all three turkey subspecies where their ranges overlap."
  ],
  "Nevada": [
    "Nevada's Merriam's turkeys are found in the mountain ranges of the northern and central parts of the state.",
    "The Jarbidge Mountains and Ruby Mountains are Nevada's most productive turkey habitat areas.",
    "Nevada's turkey tags are limited-draw in most units, maintaining quality habitat conditions."
  ],
  "New Hampshire": [
    "New Hampshire's turkey population has grown to over 40,000 from just 25 birds released in 1975.",
    "Sullivan and Cheshire counties in the southwestern part of the state support the most gobblers.",
    "New Hampshire's fall turkey management season allows either-sex harvest for population control."
  ],
  "New Jersey": [
    "New Jersey's turkey population exceeds 20,000, thriving in the agricultural-forest interface.",
    "Sussex and Warren counties in northwestern NJ are the top turkey habitat areas.",
    "New Jersey's spring season runs nearly a month, with separate zones and opening dates."
  ],
  "New Mexico": [
    "New Mexico supports Merriam's, Rio Grande, and Gould's turkey subspecies — all three in one state.",
    "The Gila National Forest is New Mexico's premier Merriam's turkey habitat area.",
    "The Sangre de Cristo Mountains near Santa Fe and Taos provide excellent high-elevation turkey habitat."
  ],
  "New York": [
    "New York has a thriving turkey population exceeding 250,000 birds statewide.",
    "The Catskill Mountains and Finger Lakes regions are New York's most productive gobbler areas.",
    "Steuben and Allegany counties in the Southern Tier consistently lead the state in spring gobbler density."
  ],
  "North Carolina": [
    "North Carolina's Uwharrie National Forest in the Piedmont is the state's top public land turkey habitat.",
    "The Appalachian foothills of Wilkes and Surry counties support impressive Eastern gobbler populations.",
    "North Carolina allows both spring and fall turkey seasons with separate management limits for each."
  ],
  "North Dakota": [
    "North Dakota's Merriam's turkeys in the Badlands and Little Missouri Grasslands provide Western habitat diversity.",
    "The Missouri River breaks and cottonwood bottoms hold the state's Eastern turkey populations.",
    "North Dakota's spring turkey tags are available over-the-counter for residents in most units."
  ],
  "Ohio": [
    "Ohio's turkey population exceeds 200,000, with the southeast hill country being the stronghold.",
    "Athens, Morgan, and Washington counties in the Appalachian foothills support the most spring gobblers.",
    "Ohio's Wayne National Forest provides the best public land turkey habitat in the state."
  ],
  "Oklahoma": [
    "Oklahoma supports both Eastern turkeys in the east and Rio Grande turkeys from central Oklahoma westward.",
    "The Ouachita Mountains in southeastern Oklahoma are the state's best Eastern turkey habitat area.",
    "McCurtain and LeFlore counties consistently support Oklahoma's highest spring gobbler populations."
  ],
  "Oregon": [
    "Oregon has both Merriam's and Rio Grande turkeys, with the Merriam's in the east and Rios in the south.",
    "The Ochoco and Malheur National Forests provide excellent public land Merriam's turkey habitat.",
    "Oregon allows two bearded turkeys per spring season, with a fall either-sex season as well."
  ],
  "Pennsylvania": [
    "Pennsylvania's turkey population exceeds 250,000, among the highest in the East.",
    "The north-central counties of Potter, Tioga, and Lycoming are Pennsylvania's Big Woods turkey country.",
    "Pennsylvania's spring season consistently supports over 30,000 gobblers annually."
  ],
  "Rhode Island": [
    "Rhode Island's turkey population has grown from zero to over 3,500 since reintroduction in 1980.",
    "The Arcadia Management Area and George Washington Management Area support the best public turkey habitat.",
    "Rhode Island's spring turkey management season allows a 1-bird limit with a short season window."
  ],
  "South Carolina": [
    "South Carolina's Lowcountry and Francis Marion National Forest support classic Eastern turkey habitat.",
    "The Santee-Cooper area and surrounding counties support some of the heaviest gobblers in the state.",
    "South Carolina's spring season opens in mid-March, one of the earliest in the Southeast."
  ],
  "South Dakota": [
    "South Dakota's Black Hills are the state's premier Merriam's turkey habitat area.",
    "The Missouri River breaks and Cedar River valley hold growing Eastern turkey populations.",
    "South Dakota allows over-the-counter spring turkey tags in the Black Hills and prairie units."
  ],
  "Tennessee": [
    "Tennessee consistently ranks in the top 5 nationally for spring gobbler populations.",
    "The Cumberland Plateau and the Tennessee River corridor are the state's most productive regions.",
    "Fentress and Morgan counties in the Upper Cumberland are significant Tennessee gobbler habitat areas."
  ],
  "Texas": [
    "Texas has the largest Rio Grande turkey population in the world, concentrated in the Edwards Plateau.",
    "The Hill Country around Mason and Llano counties is the epicenter of Rio Grande turkey habitat.",
    "Texas supports over 50,000 turkeys managed annually, with both spring and fall seasons available."
  ],
  "Utah": [
    "Utah's Merriam's turkeys were successfully introduced in the 1950s and now number over 20,000.",
    "The Wasatch Mountains and Fishlake National Forest provide Utah's best turkey habitat.",
    "Utah's limited-entry turkey permits ensure low pressure and quality habitat conditions."
  ],
  "Vermont": [
    "Vermont's turkey population has grown to over 45,000 from just 17 birds released in 1969.",
    "Bennington and Rutland counties in the southern Green Mountains support the most spring gobblers.",
    "Vermont's fall turkey management season allows either-sex harvest for population control."
  ],
  "Virginia": [
    "Virginia supports over 15,000 gobblers annually, with the Blue Ridge and Piedmont leading production.",
    "Bath, Highland, and Augusta counties in the Allegheny Mountains are Virginia's top turkey areas.",
    "Virginia was one of the first states to successfully restore wild turkey populations in the 1950s-60s."
  ],
  "Washington": [
    "Washington's Merriam's and Rio Grande turkeys are found east of the Cascades in pine and oak habitat.",
    "The Blue Mountains near Dayton and the Colville National Forest are the top turkey habitat areas.",
    "Washington offers both spring and fall turkey seasons with generous 3-bird management limits."
  ],
  "West Virginia": [
    "West Virginia's rugged Appalachian terrain supports challenging and rewarding Eastern gobbler populations.",
    "Randolph and Pocahontas counties in the Allegheny Mountains are the state's premier gobbler areas.",
    "West Virginia's spring season runs nearly a month, with both bearded-only and youth options."
  ],
  "Wisconsin": [
    "Wisconsin's turkey population has grown from 0 to over 350,000 since reintroduction in 1976.",
    "Grant and Crawford counties in the Driftless Area are Wisconsin's top spring gobbler habitat areas.",
    "Wisconsin's zone system distributes management activity, with 7 time periods across multiple zones."
  ],
  "Wyoming": [
    "Wyoming's Merriam's turkeys inhabit the Black Hills and pine-covered ridges of the northeast.",
    "The Bear Lodge Mountains and Devils Tower area provide Wyoming's best turkey habitat.",
    "Wyoming offers limited-quota spring turkey tags by draw, ensuring quality habitat with low pressure."
  ],
};

const doveFacts: Record<string, string[]> = {
  "Alabama": [
    "Alabama's September dove season is a social tradition, with gatherings on sunflower fields statewide.",
    "The Black Belt's agricultural fields support some of the highest dove densities in the Southeast.",
    "Alabama's daily dove management limit is 15 birds, with regulated activity on managed fields."
  ],
  "Arizona": [
    "Arizona's white-winged dove population has expanded significantly, making the state a major dove concentration area.",
    "The agricultural valleys around Yuma, Buckeye, and Casa Grande are Arizona's top dove habitat areas.",
    "Arizona holds a special early white-winged dove management season before the regular mourning dove season."
  ],
  "Arkansas": [
    "Arkansas' rice and soybean fields in the Grand Prairie attract massive concentrations of mourning doves.",
    "The September 1 dove season is one of the most anticipated dates on the Arkansas outdoor calendar.",
    "Stuttgart and the surrounding Delta region offer managed public dove fields on WMAs."
  ],
  "California": [
    "California is one of the top dove states, with populations supporting over 1 million birds managed annually.",
    "The Imperial Valley and Sacramento Valley are California's premier dove habitat corridors.",
    "Eurasian collared-doves can be harvested without limit in California — they are classified separately from mourning doves."
  ],
  "Colorado": [
    "Colorado's eastern plains along the Arkansas River corridor support excellent mourning dove populations over grain stubble.",
    "The Front Range urban-rural interface supports surprisingly dense dove populations near Denver and Colorado Springs.",
    "Colorado's dove season opens September 1, coinciding with peak mourning dove migration through the Central Flyway."
  ],
  "Connecticut": [
    "Connecticut was one of the last states to open a mourning dove season, first allowing it in 2021.",
    "Dove management in Connecticut is limited to specific state-managed fields with registration required.",
    "The Connecticut River valley and eastern lowlands provide the best dove habitat in the state."
  ],
  "Delaware": [
    "Delaware's agricultural fields in Sussex County attract heavy mourning dove concentrations in September.",
    "Managed dove fields at state WMAs like Cedar Swamp and Assawoman offer public access opportunities.",
    "Delaware's dove season spans September through January, providing extended management opportunities."
  ],
  "Florida": [
    "Florida's dove season opens in early October, later than most states due to the warm climate.",
    "The agricultural areas around Lake Okeechobee and the Kissimmee Prairie are Florida's top dove areas.",
    "Eurasian collared-doves have become abundant in Florida and can be managed without limits."
  ],
  "Georgia": [
    "Georgia's managed dove fields on WMAs are among the best public-access opportunities in the Southeast.",
    "The agricultural counties of the Piedmont from Macon to Augusta support excellent September dove populations.",
    "Di-Lane WMA and Rum Creek WMA host popular managed dove field events with draw-based access."
  ],
  "Idaho": [
    "Idaho's Snake River Plain and Treasure Valley are the state's most productive dove habitat areas.",
    "The agricultural fields near Boise, Nampa, and Caldwell attract large September mourning dove flights.",
    "Idaho's dove management season opens September 1, with a daily limit of 15 birds in the Pacific Flyway."
  ],
  "Illinois": [
    "Illinois ranks in the top 10 nationally for mourning dove populations, with over 500,000 managed annually.",
    "The agricultural counties of central and southern Illinois are the state's dove habitat heartland.",
    "Public dove fields at state sites like Jim Edgar Panther Creek and Clinton Lake offer managed access."
  ],
  "Indiana": [
    "Indiana's September dove season is one of the most popular small game events in the state.",
    "The Wabash Valley and White River agricultural corridors attract heavy dove concentrations.",
    "Dove activity over managed sunflower fields at state fish and wildlife areas is an Indiana tradition."
  ],
  "Iowa": [
    "Iowa's agricultural landscape provides excellent mourning dove habitat over harvested grain fields.",
    "The Missouri and Mississippi River valleys concentrate doves during their September southward migration.",
    "Iowa's dove season runs September through November, covering both the early flight and lingering birds."
  ],
  "Kansas": [
    "Kansas is a top-5 state for dove populations, with the Flint Hills and south-central prairies leading density.",
    "Cheyenne Bottoms and the surrounding farmland attract massive dove flights in early September.",
    "Kansas allows 15 doves per day and its September season is considered the unofficial start to fall field activity."
  ],
  "Kentucky": [
    "Kentucky's dove fields at Peabody and West Kentucky WMAs provide popular managed public access.",
    "The bluegrass region's horse farms and agricultural fields attract strong September dove flights.",
    "Kentucky manages over 500,000 mourning doves annually, ranking in the top 15 nationally."
  ],
  "Louisiana": [
    "Louisiana's September dove season is a major social event, with field gatherings statewide.",
    "The rice prairies of Acadiana and the cotton fields of northeast Louisiana are top dove areas.",
    "Louisiana supports over 1 million doves per season, ranking in the top 5 nationally."
  ],
  "Maryland": [
    "Maryland's Eastern Shore grain fields provide excellent dove habitat over cut corn and sunflower fields.",
    "Managed dove fields at state WMAs like LeCompte and E.A. Vaughn offer regulated public access.",
    "Queen Anne's and Caroline counties are consistently top mourning dove population areas in Maryland."
  ],
  "Michigan": [
    "Michigan's September dove season is relatively new, with mourning dove management legalized in 2004.",
    "The southern Lower Peninsula's agricultural counties provide the best dove habitat.",
    "Managed dove fields at Sharonville and Gratiot-Saginaw State Game Areas offer public access opportunities."
  ],
  "Minnesota": [
    "Minnesota's dove season runs September through November in the southern and central parts of the state.",
    "The agricultural counties of the Minnesota River valley and southeastern bluff country support the most doves.",
    "Minnesota was one of the last Midwestern states to open a dove season, beginning in 2004."
  ],
  "Mississippi": [
    "Mississippi ranks in the top 10 for dove populations, with the Delta's grain fields attracting massive flights.",
    "Managed dove fields on WMAs across the state provide some of the best public-access opportunities in the Southeast.",
    "The September 1 season start is Mississippi's most popular small game field day of the year."
  ],
  "Missouri": [
    "Missouri supports over 1.5 million doves per season, consistently ranking in the top 5 nationally.",
    "The agricultural heartland of north-central Missouri provides excellent dove habitat over harvested grain.",
    "Four Rivers CA and other MDC areas offer managed dove fields with draw-based public access."
  ],
  "Montana": [
    "Montana's dove populations are concentrated in the eastern prairies and Yellowstone River valley.",
    "The grain fields near Miles City, Glendive, and Sidney attract September mourning dove concentrations.",
    "Montana's dove season opens September 1, with 15 birds per day allowed in the Central Flyway portion."
  ],
  "Nebraska": [
    "Nebraska's dove populations are centered on the grain fields of the Platte River valley and Republican River corridor.",
    "The agricultural areas near Kearney and Grand Island support excellent early September dove concentrations.",
    "Nebraska allows 15 mourning doves per day during a season that runs from September through November."
  ],
  "Nevada": [
    "Nevada's dove populations are concentrated in the agricultural areas near Fallon and the Lahontan Valley.",
    "The Humboldt and Carson River valleys provide the best mourning dove habitat in the state.",
    "Nevada's dove populations are supplemented by strong flights of white-winged doves moving up from the south."
  ],
  "New Hampshire": [
    "New Hampshire legalized mourning dove management in 2019, one of the last states to do so.",
    "Dove habitat opportunities are concentrated in the Connecticut River valley and southern lowlands.",
    "New Hampshire's dove season is short and low-pressure, with most birds found around feeders and farms."
  ],
  "New Jersey": [
    "New Jersey's managed dove fields at Colliers Mills and other WMAs provide the state's best field access.",
    "The agricultural areas of Salem and Cumberland counties in southern NJ attract the most doves.",
    "New Jersey's dove season runs from September through November with a 15-bird daily limit."
  ],
  "New Mexico": [
    "New Mexico supports both white-winged and mourning dove populations, with strong flights through the Rio Grande valley.",
    "The Mesilla Valley near Las Cruces and the Pecos Valley near Carlsbad are top dove staging areas.",
    "New Mexico's early September dove season attracts participants from across the Southwest to its agricultural valleys."
  ],
  "North Carolina": [
    "North Carolina's managed dove fields on game lands provide excellent September field access statewide.",
    "The agricultural counties of the Piedmont and Coastal Plain support the highest dove densities.",
    "Caswell, Chatham, and Lee counties in the central Piedmont are consistently top dove population areas."
  ],
  "North Dakota": [
    "North Dakota's dove populations are centered on the grain fields and shelterbelts of the southeastern part of the state.",
    "The Drift Prairie and Red River Valley attract mourning doves that stage before their southward migration.",
    "North Dakota's dove season opens September 1 with a 15-bird limit in the Central Flyway."
  ],
  "Ohio": [
    "Ohio manages over 500,000 doves annually, with the western agricultural counties leading population density.",
    "Managed dove fields at Delaware and Grand River WMAs provide popular public access opportunities.",
    "The grain-belt counties of Darke, Mercer, and Auglaize are Ohio's most productive dove areas."
  ],
  "Oklahoma": [
    "Oklahoma is a top-3 state for dove populations, with over 2 million birds managed annually.",
    "The wheat stubble fields of central and southwestern Oklahoma attract enormous September dove flights.",
    "Oklahoma's September 1 dove season is the most participated field event in the state."
  ],
  "Oregon": [
    "Oregon's dove populations are concentrated in the agricultural valleys east of the Cascades.",
    "The Klamath Basin and Malheur County grain fields attract the state's largest dove concentrations.",
    "Oregon's Pacific Flyway dove limit is 15 per day during a season running September through October."
  ],
  "Pennsylvania": [
    "Pennsylvania's managed dove fields at state game lands provide the best public dove access in the Northeast.",
    "The agricultural counties of Lancaster, York, and Adams in southeastern PA support the most doves.",
    "SGL 211 and SGL 205 are among Pennsylvania's most popular managed dove field areas."
  ],
  "Rhode Island": [
    "Rhode Island's dove populations are limited but present on state management areas and private farmland.",
    "The Arcadia Management Area in the western part of the state offers the best dove habitat.",
    "Rhode Island's dove season runs September through November with a 15-bird daily limit."
  ],
  "South Carolina": [
    "South Carolina's managed dove fields on plantation lands are a traditional Southern field gathering.",
    "The Midlands agricultural region from Orangeburg to Sumter supports the state's top dove populations.",
    "South Carolina opens dove season September 1, with special field events on WMAs drawing hundreds of participants."
  ],
  "South Dakota": [
    "South Dakota's dove populations are concentrated on grain fields of the James and Missouri River valleys.",
    "The southeastern counties near Sioux Falls and Yankton support the state's highest dove densities.",
    "South Dakota's dove season opens September 1 with a 15-bird limit in the Central Flyway."
  ],
  "Tennessee": [
    "Tennessee's managed dove fields on WMAs like Forks of the River and Yanahli offer excellent public access.",
    "The agricultural counties of west Tennessee from Jackson to Memphis support the highest dove populations.",
    "Tennessee's September 1 dove season is the most popular small game field day in the state."
  ],
  "Texas": [
    "Texas leads the nation in dove populations, with 5-7 million mourning and white-winged doves managed annually.",
    "The South Texas Brush Country and Rio Grande Valley host massive white-winged dove populations.",
    "Texas' special early white-winged dove season in the South Zone is a significant September tradition."
  ],
  "Utah": [
    "Utah's dove populations are centered on the agricultural areas of the Wasatch Front and Cache Valley.",
    "The fields near Brigham City and Logan attract mourning doves staging before their fall migration.",
    "Utah's dove season opens September 1 with a 15-bird limit in the Pacific Flyway."
  ],
  "Virginia": [
    "Virginia's managed dove fields on WMAs across the Piedmont and Valley provide top public access.",
    "The agricultural counties of the Shenandoah Valley and Southside support the state's best dove populations.",
    "Amelia WMA and Cavalier WMA host popular opening-day dove field events with draw-based registration."
  ],
  "Washington": [
    "Washington's dove populations are concentrated in the agricultural areas of the Columbia Basin.",
    "The Walla Walla Valley and Yakima Valley grain fields attract September mourning dove flights.",
    "Washington's dove season runs September 1 through October 30 with a 15-bird daily limit."
  ],
  "West Virginia": [
    "West Virginia's dove populations are densest in the eastern Panhandle's agricultural areas around Martinsburg.",
    "Managed dove fields at Shannondale and Sleepy Creek WMAs provide the state's best public access.",
    "West Virginia's mountainous terrain limits dove habitat, concentrating birds in the valley farmlands."
  ],
  "Wisconsin": [
    "Wisconsin's mourning dove season was re-established in 2003 after decades of protection.",
    "The agricultural areas of the southwestern Driftless Area support the best dove populations in the state.",
    "Dove populations in Wisconsin are concentrated in the southern and western counties along the Mississippi."
  ],
  "Wyoming": [
    "Wyoming's dove populations are centered on the grain fields of the eastern plains and Bighorn Basin.",
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
