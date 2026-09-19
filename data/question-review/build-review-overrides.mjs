import { writeFileSync } from 'node:fs';

// Independent editorial review of all 727 initial synonym and 661 antonym rows.
// Retain these explicit decisions when regenerating the question bank.
const overrides = {};
const set = (type, word, fix) => { const key = `${type}:${word}`; overrides[key] = {...overrides[key], ...fix}; };
const answer = (type, word, value, reason) => set(type, word, {answer:value, reason});
const sense = (type, word, value) => set(type, word, {sense:value});
const exclude = (word, reason) => set('ant', word, {exclude:true, reason});
const distractors = (type, word, values, reason='Remove an alternative defensible answer from the four options.') => set(type, word, {distractors:values, reason});

for (const [word, reason] of Object.entries({
  composition:'A composed work is not the opposite of decomposition, which names a different process.',
  conscience:'A moral faculty is not the opposite of immoral behaviour.',
  enterprise:'A business or project has no simple lexical opposite; inactivity contrasts with initiative, a different sense.',
  explanation:'Confusion can persist despite an explanation and is not its antonym.',
  merchant:'Customer is a reciprocal role, not an opposite; a merchant is also a buyer.',
  raiment:'Clothing and the state of nakedness are not matching lexical opposites.',
  scripture:'Secular writing is a contrasting category, not a lexical opposite of sacred writings.',
  beck:'A beckoning gesture has no clear antonym among the supplied nouns.',
  complement:'A mismatch is not an antonym of a completing or enhancing addition.',
  conflagration:'Extinguishment ends a fire; it is not the antonym of a fire.',
  evaluation:'Neglect is not an antonym of assessment.',
  harbour:'The open sea is a contrasting location, not an antonym of a port.',
  incision:'Closure is an action or state, not the lexical opposite of a surgical cut.',
  inhabitants:'Visitors are contrasting occupants; the roles are not lexical opposites.',
  pigment:'Bleach removes colour but is not an antonym of a colouring substance.',
  slit:'A closure is not the lexical opposite of a narrow cut.',
  vent:'A seal closes a vent; this is an association rather than an antonym.',
  fissure:'Seal is an action or object, not an antonym of a crack.',
  crevice:'A solid surface is not a lexical antonym of a crack.',
  adolescent:'Adult and infant flank adolescence; neither is a unique lexical opposite.',
  ingredient:'A part and its whole are a relation, not antonyms.',
  shack:'A mansion differs in size and quality but is not a lexical antonym of a hut.',
  cellar:'Attic is a contrasting location, not a lexical antonym of basement.',
  notion:'An idea or belief can be factual; fact is not its antonym.',
  hind:'Stag is a male counterpart, not a lexical antonym of female deer.',
  proxy:'Principal is a represented role, not a lexical antonym of representative.',
  blot:'Clean mark is not an established opposite of stain.',
  chore:'Pleasure is a feeling, not the lexical opposite of a routine task.',
  tepid:'Both hot and cold contrast with lukewarm; no unique directional opposite exists.',
})) exclude(word, reason);

for (const [word,value] of Object.entries({affable:'sociable',oppress:'persecute',pigment:'colouring',prose:'ordinary writing',rural:'pastoral',urban:'metropolitan',extravagance:'excess',amoral:'morally indifferent',hammock:'hanging bed',artefact:'man-made object',witty:'amusing',vapour:'steam',heed:'pay attention',myriad:'multitude',yacht:'pleasure boat',hygienic:'sanitary'})) answer('syn',word,value,'Choose a closer relation matching the taught sense, rather than a broad association or mismatched part of speech.');
answer('syn','break a leg','good luck','Supply the common equivalent of the idiom; no supplied synonym was present.');
answer('syn','crack up','burst into laughter','Supply the common equivalent in the laughter sense of the idiom.');
answer('syn','chew the fat','chat','Supply the common equivalent of the idiom.');
sense('syn','crack up','laughing');
for (const [word,value] of Object.entries({affable:'unfriendly',assiduous:'indolent',deceive:'tell the truth',feign:'be genuine',repent:'remain unrepentant',arid:'moist',sage:'fool',subterranean:'aboveground',mist:'clear air',baffle:'enlighten',brittle:'tough',scalding:'cold',waver:'remain firm',procrastinate:'act promptly',domestic:'non-domestic'})) answer('ant',word,value,'Replace a loose contrast or wrong sense with a defensible opposite.');
// No single-word opposite in the household sense; avoid teaching national/foreign
// as though it were an opposite of household. Keep the definition and synonym.
exclude('domestic','Foreign contrasts with the national sense, which is absent from the taught household definition.');

distractors('syn','commence',['loathsome','hammock','marquee']);
distractors('syn','subterfuge',['vein','heed','cellar'],'Avoid a near-identical verb distracting from its noun relation.');
distractors('syn','condemn',['crevice','sway','cellar']);
distractors('syn','imitate',['severe','disarray','cellar']);
distractors('syn','apprehend',['apparent','peculiar','cellar']);
distractors('syn','sagacious',['myth','cellar','fracas']);
distractors('syn','salient',['indolent','cellar','lout']);
distractors('ant','cordial',['seize','cellar','unsurpassed']);
distractors('ant','controversy',['witty','cellar','unfathomable']);
distractors('ant','subdued',['cellar','vulpine','auspicious']);
distractors('ant','impair',['cellar','scoff','yacht']);
distractors('ant','nebulous',['chore','cellar','cordial']);
distractors('ant','radiant',['conscientious','cellar','pious']);
distractors('ant','diplomatic',['crevice','compliant','cellar']);
distractors('ant','hustle',['cellar','trough','rural']);
distractors('ant','meticulous',['cellar','abhor','prose']);

const commonSenses = {
 antiquity:'a historical period', contemporary:'describing modern art', apparent:'describing an obvious fact',
 fleet:'at sea', helix:'a shape', immerse:'in liquid', matte:'a surface finish',
 perish:'in a disaster', quaint:'describing an old village', rigid:'a material', grave:'a warning',
 liable:'for damage', lofty:'a tower', margin:'of a page', oblige:'a rule obliges someone to act',
 subordinate:'a rank', peculiar:'a habit', stationary:'a vehicle', summit:'of a mountain',
 torment:'a feeling', volatile:'a situation', grit:'a personal quality', rivet:'an audience',
 sanction:'permission', acid:'describing a substance', coil:'a rope, as a verb',
 ramble:'on foot', sole:'the sole survivor', wax:'the moon', slack:'a rope',
 blunt:'a cutting edge', hawk:'goods at a market', limp:'walking', obtuse:'a person, not an angle',
 acute:'pain', crooked:'a line', pique:'interest', exile:'a punishment',
 tally:'the votes', crop:'hair, as a verb', club:'a weapon', abrupt:'a change', tangle:'threads, as a verb',
 twine:'a material', stagnant:'water', mobile:'a device', dopey:'from tiredness', sage:'a person',
 subtle:'a flavour', lean:'against a wall', radiant:'an expression', legend:'a traditional story',
 current:'fashion', potential:'a future possibility', myriad:'a myriad of stars', uniform:'a pattern',
 desire:'a feeling', apprehend:'a suspect', resonate:'a sound', sway:'in the breeze',
 trough:'carrying water', vice:'a moral quality', sedate:'a manner', superficial:'an investigation',
 bland:'in flavour', insipid:'in flavour', skim:'a text', veteran:'in a profession',
 kindle:'a fire', dictate:'instructions', fester:'a wound', fringe:'of an area',
 serpentine:'a road', demolish:'a building', flog:'goods at a market',
};
// Apply context only to real source words; selected senses differ by relation below.
for(const [word,value] of Object.entries(commonSenses)) for(const type of ['syn','ant']) sense(type,word,value);
sense('syn','quench','thirst'); sense('ant','quench','a fire');
sense('syn','yield','a harvest'); sense('ant','yield','in a contest');
sense('syn','slack','about rules'); sense('ant','slack','a rope');
sense('ant','blunt','in speech');
sense('ant','tally','two accounts tally');
sense('ant','twine','threads, as a verb');
sense('ant','subtle','a hint');
sense('ant','myriad','myriad stars');
sense('ant','trough','of a wave');
sense('ant','kindle','a feeling');
sense('syn','fester','a problem');
sense('syn','radiant','a light');
sense('syn','myth','a traditional story'); sense('ant','myth','a false belief');
sense('ant','vile','morally bad');
sense('syn','virulent','of a disease'); sense('ant','virulent','of a disease');
answer('syn','quaint','old-fashioned','Use the direct old-fashioned sense, rather than the broader visual association picturesque.');

writeFileSync(new URL('./overrides.json',import.meta.url),JSON.stringify(overrides,null,2)+'\n');
console.log(`${Object.keys(overrides).length} editorial decisions written.`);
