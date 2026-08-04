import chalk    from 'npm:chalk';
import boxen    from 'npm:boxen';
import ora      from 'npm:ora';
import figlet   from 'npm:figlet';
import inquirer from 'npm:inquirer';

// --- Utility Functions ---
// A simple helper to simulate time passing for our spinner actions
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Types ---
type Mood = 'Happy' | 'Sad' | 'Tired' | 'Dead';

// --- The Virtual Pet Class ---
class CyberPet {
  name: string;
  hunger: number = 50;
  happiness: number = 50;
  energy: number = 50;
  age: number = 0;

  constructor(name: string) {
    this.name = name;
  }

  // Pet dies if hunger maxes out, or if happiness/energy hit zero
  get isAlive(): boolean {
    return this.hunger < 100 && this.happiness > 0 && this.energy > 0;
  }

  // Determine the pet's current mood based on its stats
  get mood(): Mood {
    if (!this.isAlive) return 'Dead';
    if (this.energy < 30) return 'Tired';
    if (this.hunger > 70 || this.happiness < 30) return 'Sad';
    return 'Happy';
  }

  // Return an ASCII face based on mood
  get face(): string {
    switch (this.mood) {
      case 'Happy': return ' ( ^.^ ) ';
      case 'Sad':   return ' ( ;.; ) ';
      case 'Tired': return ' ( -.- )z';
      case 'Dead':  return ' ( x.x ) ';
    }
  }

  // Compose the full ASCII pet art
  get asciiArt(): string {
    return `
      /\\_/\\
     ${this.face}
      > ^ <
    `;
  }

  // Progress time: affects stats randomly
  tick() {
    this.hunger = Math.min(110, this.hunger + Math.floor(Math.random() * 10) + 5);
    this.happiness = Math.max(-10, this.happiness - (Math.floor(Math.random() * 10) + 5));
    this.energy = Math.max(-10, this.energy - (Math.floor(Math.random() * 10) + 5));
    this.age += 1;
  }

  // Render the pet's current status inside a styled terminal box
  printStatus() {
    // Dynamic color coding for stats
    const hColor = this.hunger < 50 ? chalk.green : this.hunger < 80 ? chalk.yellow : chalk.red;
    const hapColor = this.happiness > 50 ? chalk.green : this.happiness > 20 ? chalk.yellow : chalk.red;
    const eColor = this.energy > 50 ? chalk.green : this.energy > 20 ? chalk.yellow : chalk.red;

    const stats = [
      chalk.cyan.bold(`Name: ${this.name} (Age: ${this.age})`),
      `Mood: ${chalk.bold(this.mood)}`,
      hColor(`Hunger:    ${Math.max(0, this.hunger)} / 100`),
      hapColor(`Happiness: ${Math.max(0, this.happiness)} / 100`),
      eColor(`Energy:    ${Math.max(0, this.energy)} / 100`),
    ].join('\n');

    const display = `${chalk.magenta(this.asciiArt)}\n\n${stats}`;

    console.log(
      boxen(display, {
        padding: 1,
        margin: 1,
        borderStyle: 'round',
        borderColor: 'cyan',
        title: ' Node-Gotchi Status ',
        titleAlignment: 'center',
      })
    );
  }

  // --- Actions ---
  async feed() {
    const spinner = ora('Feeding your pet...').start();
    await wait(1500);
    this.hunger = Math.max(0, this.hunger - 30);
    this.energy += 5;
    spinner.succeed('Yum! That was delicious.');
  }
  
  async play() {
    const spinner = ora('Playing a game...').start();
    await wait(1500);
    this.happiness = Math.min(100, this.happiness + 30);
    this.energy -= 15;
    this.hunger += 10;
    spinner.succeed('So much fun!');
  }

  async sleep() {
    const spinner = ora('Sleeping...').start();
    await wait(2500);
    this.energy = Math.min(100, this.energy + 40);
    this.hunger += 15;
    spinner.succeed('Zzz... Well rested!');
  }
}

// --- Main Game Loop ---
async function main() {
  console.clear();
  
  // Print a cool ASCII Banner
  console.log(
    chalk.magenta(figlet.textSync('Node-Gotchi', { horizontalLayout: 'full' }))
  );
  console.log(chalk.gray('A terminal virtual pet written in TypeScript\n'));

  // Get the pet's name
  const { petName } = await inquirer.prompt([
    {
      type: 'input',
      name: 'petName',
      message: 'What would you like to name your pet?',
      default: 'BiteSize',
    },
  ]);

  const pet = new CyberPet(petName);

  // Core Loop
  while (pet.isAlive) {
    console.clear();
    pet.printStatus();

    const { action } = await inquirer.prompt([
      {
        type: 'rawlist',
        name: 'action',
        message: 'What do you want to do?',
        choices: ['Feed', 'Play', 'Sleep', 'Do Nothing', 'Quit'],
      },
    ]);

    if (action === 'Quit') {
      console.log(chalk.yellow('\nThanks for playing! Goodbye.'));
      process.exit(0);
    }

    // Perform the selected action
    switch (action) {
      case 'Feed':
        await pet.feed();
        break;
      case 'Play':
        await pet.play();
        break;
      case 'Sleep':
        await pet.sleep();
        break;
      case 'Do Nothing':
        console.log(chalk.italic('You stare at your pet. It stares back...'));
        await wait(1500);
        break;
    }

    // Advance time and age the pet
    pet.tick();
    await wait(1000); // Brief pause before the loop repeats
  }

  // --- Game Over State ---
  console.clear();
  pet.printStatus();
  console.log(chalk.bgRed.white.bold('\n G A M E   O V E R \n'));
  console.log(chalk.red(`Sadly, through neglect, ${pet.name} has passed away at age ${pet.age}.\n`));
}

// Boot up the game
main().catch((err) => {
  console.error(chalk.red('A fatal error occurred:'), err);
  process.exit(1);
});