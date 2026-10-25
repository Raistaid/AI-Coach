import football from './football.js';
import balance from './balance.js';
import squats from './squats.js';
import lunges from './lunges.js';
import pushups from './pushups.js';
import plank from './plank.js';
import jacks from './jacks.js';
import highknees from './highknees.js';

// Catalog order: football first, then strength, then cardio. A new skill is one file plus one line here.
export const SKILL_LIST = [football, balance, squats, lunges, pushups, plank, jacks, highknees];
export const SKILLS = Object.fromEntries(SKILL_LIST.map(skill => [skill.id, skill]));
export const getSkill = (id) => SKILLS[id] || football;
export { PERSONALITIES, DEFAULT_PERSONALITY, personalityId, CATEGORIES } from './common.js';
