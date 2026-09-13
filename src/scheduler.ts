import cron from 'node-cron';
import {  enviarRecordatorios3h, enviarRecordatorios24h } from './services/notificaciones.services';

export function iniciarScheduler() {
  cron.schedule('*/10 * * * *', () => {
    
    enviarRecordatorios3h();
    enviarRecordatorios24h();
  });
  console.log('⏰ Scheduler de notificaciones iniciado');
}