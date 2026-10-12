// Lista de módulos ativos. Para adicionar uma integração nova (WhatsApp, Calendly, Google Agenda...):
// crie a pasta em src/modules/<nome>/index.js exportando { name, register(app) } e acrescente aqui.
import auth from './auth/index.js';
import users from './users/index.js';
import stages from './stages/index.js';
import leads from './leads/index.js';
import followup from './followup/index.js';
import yayforms from './yayforms/index.js';

export const modulos = [auth, users, stages, leads, followup, yayforms];
