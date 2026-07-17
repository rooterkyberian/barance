import { initPhysics } from './sim';
import { Game } from './game';
import { BARS, PLATE_LIST } from './config';

async function main(): Promise<void> {
  await initPhysics();
  const game = new Game();
  // Debug/testing handles: window.bl.grabFromTray(25), .placeHand('R', 0), .advance(2)…
  (window as Window & { bl?: Game }).bl = game;
  (window as Window & { blData?: unknown }).blData = { plates: PLATE_LIST, bars: BARS };
  game.start();
}

void main();
