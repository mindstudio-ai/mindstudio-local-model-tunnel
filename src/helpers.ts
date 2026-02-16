import chalk from 'chalk';
import { type LocalModel } from './providers/index.js';

export const displayModels = (models: LocalModel[]): void => {
  const textModels = models.filter((m) => m.capability === 'text');
  const imageModels = models.filter((m) => m.capability === 'image');

  if (textModels.length > 0) {
    console.log(chalk.green('\nText Models\n'));
    textModels.forEach((m) => {
      const providerTag = chalk.green(`[${m.provider}]`);
      console.log(`  ${chalk.green('*')} ${m.name} ${providerTag}`);
    });
  }

  if (imageModels.length > 0) {
    console.log(chalk.magenta('\nImage Models\n'));
    imageModels.forEach((m) => {
      const providerTag = chalk.magenta(`[${m.provider}]`);
      console.log(`  ${chalk.magenta('*')} ${m.name} ${providerTag}`);
    });
  }

  console.log('');
};

export const LogoString = `
        .=+-.     :++.
        *@@@@@+  :%@@@@%:
      .%@@@@@@#..@@@@@@@=
    .*@@@@@@@--@@@@@@@#.**.
    *@@@@@@@.-@@@@@@@@.#@@*
  .#@@@@@@@-.@@@@@@@* #@@@@%.
  =@@@@@@@-.@@@@@@@#.-@@@@@@+
  :@@@@@@:  +@@@@@#. .@@@@@@:
    .++:     .-*-.     .++:   `;
