// Lista de módulos ativos. Para adicionar uma integração nova (ex.: Google Agenda):
// crie a pasta em src/modules/<nome>/index.js exportando { name, register(app), start?(), stop?() }
// e acrescente aqui. start() roda depois que o servidor liga; stop() antes de desligar.
import auth from './auth/index.js';
import users from './users/index.js';
import stages from './stages/index.js';
import leads from './leads/index.js';
import followup from './followup/index.js';
import yayforms from './yayforms/index.js';
import calendly from './calendly/index.js';
import whatsapp from './whatsapp/index.js';
import estatisticas from './estatisticas/index.js';
import disparos from './disparos/index.js';
import sistema from './sistema/index.js';

export const modulos = [auth, users, stages, leads, followup, yayforms, calendly, whatsapp, disparos, estatisticas, sistema];
