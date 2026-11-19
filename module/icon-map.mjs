const SYSTEM='project-genesis';
const local=(path)=>`systems/${SYSTEM}/${path}`;
export const RESOURCE_ICONS=Object.freeze({
  wood:local('assets/resources/wood.svg'),
  stone:local('assets/resources/stone.svg'),
  fiber:local('assets/resources/fiber.svg'),
  ore:local('assets/resources/ore.svg'),
  clay:local('assets/resources/clay.svg'),
  scrap:local('assets/resources/scrap.svg'),
  sample:local('assets/resources/sample.svg'),
  organic:local('assets/resources/organic.svg'),
  copper:local('assets/resources/copper.svg'),
  silicon:local('assets/resources/silicon.svg'),
  crystal:local('assets/resources/crystal.svg'),
  iron_ore:local('assets/resources/iron_ore.svg'),
  tin_ore:local('assets/resources/tin_ore.svg'),
  aluminum_ore:local('assets/resources/aluminum_ore.svg'),
  titanium_ore:local('assets/resources/titanium_ore.svg'),

  plank:local('assets/items/plank.png'),
  cloth:local('assets/items/cloth.png'),
  brick:local('assets/items/brick.png'),
  cut_stone:local('assets/items/cut_stone.png'),
  ingot:local('assets/items/ingot.png'),
  copper_ingot:local('assets/items/copper_ingot.png'),
  iron_ingot:local('assets/items/iron_ingot.png'),
  tin_ingot:local('assets/items/tin_ingot.png'),
  aluminum_ingot:local('assets/items/aluminum_ingot.png'),
  titanium_ingot:local('assets/items/titanium_ingot.png'),
  steel_ingot:local('assets/items/steel_ingot.png'),
  bronze_ingot:local('assets/items/bronze_ingot.png'),
  wire_bundle:local('assets/items/wire_bundle.png'),
  iron_fittings:local('assets/items/iron_fittings.png'),
  steel_plate:local('assets/items/steel_plate.png'),
  titanium_frame:local('assets/items/titanium_frame.png'),
  joinery_kit:local('assets/items/joinery_kit.png'),
  calibrated_toolkit:local('assets/items/calibrated_toolkit.png'),

  field_notes:'icons/sundries/documents/document-torn-diagram-tan.webp',
  shelter_kit:'icons/environment/settlement/tent.webp',
  stone_kit:'icons/tools/hand/hammer-stone-brown.webp',
  water_tester:'icons/consumables/potions/bottle-round-corked-blue.webp',
  field_collection:'icons/containers/bags/case-leather-tan.webp',
  workshop_tools:'icons/tools/hand/hammer-and-nail-steel.webp',
  growth_module:'icons/commodities/flowers/buds-black.webp',
  geology_kit:'icons/tools/hand/pickaxe-steel-grey.webp',
  med_module:'icons/consumables/potions/potion-bottle-red.webp',
  mechanism:'icons/commodities/metal/gear-copper.webp',
  handcart:'icons/tools/cooking/cauldron-tripod.webp',
  alloy:'icons/commodities/metal/metal-chunks-grey.webp',
  glass:'icons/commodities/materials/glass-cabochon-blue.webp',
  circuit:'icons/sundries/scrolls/scroll-runed-brown.webp'
});

export function iconForCode(code, fallback='icons/svg/item-bag.svg'){
  return RESOURCE_ICONS[String(code||'').trim().toLowerCase()] || fallback;
}

export function iconForRecipe(recipe, fallback='icons/svg/item-bag.svg'){
  const out=recipe?.output?.code || recipe?.output?.resourceCode || recipe?.id;
  return iconForCode(out, fallback);
}
