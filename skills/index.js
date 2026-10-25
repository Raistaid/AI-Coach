import football from './football.js';
import squats from './squats.js';
import balance from './balance.js';

export const SKILLS = { football, squats, balance };
export const SKILL_LIST = [football, squats, balance];
export const getSkill = (id) => SKILLS[id] || football;
export { PERSONALITIES, DEFAULT_PERSONALITY, personalityId } from './common.js';
