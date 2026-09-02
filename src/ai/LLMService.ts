/**
 * LLM Service
 * Provides AI text generation for the game.
 * Currently powered by the template-based D&D Knowledge Engine.
 * The abstraction allows future WebLLM/Local LLM integration.
 */

import {
  generateRoomDescription,
  generateMonsterDescription,
  generateCombatTurnNarration,
  generateVictoryNarration,
  generateTreasureDescription,
  generateDungeonLore,
  generatePartyCommentary,
  generateSpellDescription,
  generateNPCDialogue,
  generateNPCIntroduction,
  generateLocationDescription,
  generateConditionLore,
  generatePlaneLore,
  generateDeityLore,
  generateFactionLore,
  generateRumor,
  generateQuestHook,
  generateTavernScene,
  generateProphecy,
  generateLegendTale,
  generateTrapLore,
  generatePuzzleLore,
  generateWeatherLore,
  generateRuleLore,
  generateAlignmentMusing,
  describeSubclass,
  describeSubclassFromText,
  generateCurseLore,
  generateDiseaseLore,
  generateLanguageLore,
  generateFeatLore,
  CombatTurnContext,
} from './LoreGenerator';

import {
  BESTIARY,
  SPELLS_EXPANDED,
  MAGIC_ITEMS,
  NPC_TEMPLATES,
  LOCATIONS,
  getBestiaryEntry,
  getSpell,
  getRandomElement,
} from './DnDKnowledge';

export interface LLMConfig {
  provider: 'template' | 'webllm';
  model?: string;
  temperature?: number;
}

export class LLMService {
  private config: LLMConfig;
  private modelLoaded: boolean = false;

  constructor(config: LLMConfig = { provider: 'template' }) {
    this.config = config;
  }

  get provider(): string {
    return this.config.provider;
  }

  get isLoaded(): boolean {
    return this.modelLoaded;
  }

  async initialize(): Promise<void> {
    if (this.config.provider === 'webllm') {
      // Future: load WebLLM model
      // For now, fall back to template engine
      console.log('[LLM] WebLLM not yet available — using template engine');
      this.config.provider = 'template';
    }
    this.modelLoaded = true;
  }

  // ── Room Descriptions ──────────────────────────
  describeRoom(dungeonLevel: number): string {
    return generateRoomDescription(dungeonLevel);
  }

  // ── Combat Narration ───────────────────────────
  narrateCombatTurn(ctx: CombatTurnContext): string {
    return generateCombatTurnNarration(ctx);
  }

  narrateVictory(): string {
    return generateVictoryNarration();
  }

  // ── Monster Descriptions ───────────────────────
  describeMonster(monsterId: string): string {
    return generateMonsterDescription(monsterId);
  }

  describeMonsterBrief(monsterId: string): string {
    const entry = getBestiaryEntry(monsterId);
    if (!entry) return 'A mysterious creature.';
    return `${entry.name} (CR ${entry.cr}) — ${entry.type}. ${entry.description.split('.')[0]}.`;
  }

  // ── Spell & Item Lore ──────────────────────────
  describeSpell(spellId: string): string {
    return generateSpellDescription(spellId);
  }

  describeItem(): string {
    const item = getRandomElement(MAGIC_ITEMS);
    return `${item.name} (${item.rarity}): ${item.description.substring(0, 120)}...`;
  }

  // ── Dungeon Lore ───────────────────────────────
  narrateDungeonLore(dungeonLevel: number): string {
    return generateDungeonLore(dungeonLevel);
  }

  // ── Treasure ───────────────────────────────────
  describeTreasure(dungeonLevel: number): string {
    return generateTreasureDescription(dungeonLevel);
  }

  // ── Party Commentary ───────────────────────────
  partyComment(
    name: string,
    charClass: string,
    personality: { aggression: number; caution: number; curiosity: number; loyalty: number; greed: number },
    situation: 'entering_dungeon' | 'finding_treasure' | 'low_health' | 'seeing_monster' | 'victory' | 'defeat'
  ): string {
    return generatePartyCommentary(name, charClass, personality, situation);
  }

  // ── NPC Interactions ───────────────────────────
  introduceNPC(): string {
    const npc = getRandomElement(NPC_TEMPLATES);
    return generateNPCIntroduction(npc.id);
  }

  npcDialogue(context: 'greeting' | 'quest' | 'combat' | 'farewell'): string {
    const npc = getRandomElement(NPC_TEMPLATES);
    return `"${generateNPCDialogue(npc.id, context)}"`;
  }

  // ── Free text generation (template-based) ──────
  generate(prompt: string, context?: Record<string, string>): string {
    // Simple pattern matching for key scenarios
    const clean = prompt.toLowerCase();

    if (clean.includes('describe') && clean.includes('dungeon')) {
      return generateDungeonLore(3);
    }
    if (clean.includes('room') || clean.includes('chamber') || clean.includes('hall')) {
      return generateRoomDescription(context?.dungeonLevel ? parseInt(context.dungeonLevel) : 1);
    }
    if (clean.includes('monster') || clean.includes('creature') || clean.includes('enemy')) {
      const monster = getRandomElement(BESTIARY);
      return generateMonsterDescription(monster.id);
    }
    // Specific grimoire topics before generic word collisions
    if (/\bfeat\b/.test(clean)) {
      return this.describeFeat();
    }
    if (clean.includes('prophecy') || clean.includes('foretell') || clean.includes('omen')) {
      return this.speakProphecy();
    }
    if (clean.includes('legend') || clean.includes('story') || clean.includes('tale')) {
      return this.tellLegend();
    }
    if (clean.includes('rumor') || clean.includes('gossip') || clean.includes('heard')) {
      return this.tellRumor(context?.dungeonName);
    }
    if (clean.includes('quest') || clean.includes('job') || clean.includes('bounty')) {
      return this.offerQuestHook();
    }
    if (clean.includes('trap')) {
      return this.describeTrap();
    }
    if (clean.includes('puzzle') || clean.includes('riddle')) {
      return this.describePuzzle();
    }
    if (clean.includes('god') || clean.includes('deity') || clean.includes('religion') || clean.includes('temple') || clean.includes('priest')) {
      return this.describeDeity();
    }
    if (clean.includes('plane') || clean.includes('hell') || clean.includes('abyss') || clean.includes('heaven') || clean.includes('feywild') || clean.includes('shadowfell') || clean.includes('astral') || clean.includes('limbo') || clean.includes('mechanus') || clean.includes('sigil')) {
      return generatePlaneLore(clean);
    }
    if (clean.includes('poisoned') || clean.includes('condition') || clean.includes('paralyzed') || clean.includes('stunned') || clean.includes('charmed') || clean.includes('frightened') || clean.includes('petrified') || clean.includes('grappled') || clean.includes('restrained')) {
      return this.describeCondition();
    }
    if (clean.includes('curse') || clean.includes('cursed')) {
      return this.describeCurse();
    }
    if (clean.includes('disease') || clean.includes('plague') || clean.includes('sick')) {
      return this.describeDisease();
    }
    if (clean.includes('weather') || clean.includes('storm') || clean.includes('rain')) {
      return this.describeWeather();
    }
    if (clean.includes('advantage') || clean.includes('rule') || clean.includes('death save') || clean.includes('short rest') || clean.includes('long rest') || clean.includes('cover') || clean.includes('concentration') || clean.includes('initiative')) {
      return this.explainRule();
    }
    if (clean.includes('alignment') || clean.includes('lawful') || clean.includes('chaotic') || clean.includes('neutral good') || clean.includes('true neutral') || clean.includes('neutral evil')) {
      return generateAlignmentMusing(clean);
    }
    if (clean.includes('faction') || clean.includes('guild') || clean.includes('harpers') || clean.includes('zhentarim')) {
      return this.describeFaction();
    }
    if (clean.includes('language') || clean.includes('tongue')) {
      return this.describeLanguage();
    }
    if (clean.includes('subclass') || clean.includes('tradition') || clean.includes('school of')) {
      return describeSubclassFromText(clean);
    }
    if (clean.includes('location') || clean.includes('castle') || clean.includes('tower') || clean.includes('shrine')) {
      const loc = getRandomElement(LOCATIONS);
      return generateLocationDescription(loc.id);
    }

    // Generic content branches
    if (clean.includes('item') || clean.includes('weapon') || clean.includes('armor') || clean.includes('sword') || clean.includes('ring') || clean.includes('staff')) {
      return this.describeItem();
    }
    if (clean.includes('spell') || clean.includes('magic') || clean.includes('arcane')) {
      const spell = getRandomElement(SPELLS_EXPANDED);
      return generateSpellDescription(spell.id);
    }
    if (clean.includes('npc') || clean.includes('tavern') || clean.includes('shop')) {
      const npc = getRandomElement(NPC_TEMPLATES);
      return `You encounter ${npc.name}, a ${npc.occupation}. "${npc.dialogueExamples[0]}"`;
    }

    // Default: generate lore
    if (Math.random() < 0.5) {
      return generateDungeonLore(2);
    }
    return generateRoomDescription(2);
  }

  // ── Grimoire methods ───────────────────────────
  describeCondition(): string { return generateConditionLore(); }
  describePlane(): string { return generatePlaneLore(); }
  describeDeity(): string { return generateDeityLore(); }
  describeFaction(): string { return generateFactionLore(); }
  tellRumor(dungeonName?: string): string { return generateRumor(dungeonName); }
  offerQuestHook(): string { return generateQuestHook(); }
  openTavernScene(): string { return generateTavernScene(); }
  speakProphecy(): string { return generateProphecy(); }
  tellLegend(): string { return generateLegendTale(); }
  describeTrap(): string { return generateTrapLore(); }
  describePuzzle(): string { return generatePuzzleLore(); }
  describeWeather(biome?: 'temperate' | 'mountain' | 'desert' | 'swamp' | 'underground'): string { return generateWeatherLore(biome); }
  explainRule(): string { return generateRuleLore(); }
  museOnAlignment(): string { return generateAlignmentMusing(); }
  describeSubclassFor(classId: string): string { return describeSubclass(classId); }
  describeCurse(): string { return generateCurseLore(); }
  describeDisease(): string { return generateDiseaseLore(); }
  describeLanguage(): string { return generateLanguageLore(); }
  describeFeat(): string { return generateFeatLore(); }
}

// Singleton
let instance: LLMService | null = null;

export function getLLM(): LLMService {
  if (!instance) {
    instance = new LLMService();
    instance.initialize();
  }
  return instance;
}

export function createLLM(config: LLMConfig): LLMService {
  instance = new LLMService(config);
  instance.initialize();
  return instance;
}