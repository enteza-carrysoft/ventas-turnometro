import { describe, expect, it } from 'vitest';
import { classifyEmail, containsPersonName, isBusinessWebmail, EMAIL_PERSONAL, PERSONA, redactPersonalData } from './redact.js';

describe('redactPersonalData: lo que se envía al modelo no lleva nombres de personas (P2.3, REQ-ENR-01 CA3)', () => {
  it.each([
    ['Atiende la Dra. María López Pérez en consulta 2', `Atiende la ${PERSONA} en consulta 2`],
    ['Dr. Juan Pérez, fisioterapeuta', `${PERSONA}, fisioterapeuta`],
    ['Dña. María de los Ángeles López es la gerente', `${PERSONA} es la gerente`],
    ['Fdo. Pedro Gómez', PERSONA],
    ['Doctora Ana Ruiz y Doctor Luis Mora', `${PERSONA} y ${PERSONA}`],
    ['D. Pedro', PERSONA],
    ['Sr. José Antonio Fernández de la Vega atiende', `${PERSONA} atiende`],
  ])('%s', (input, expected) => expect(redactPersonalData(input)).toBe(expected));

  it('no toca el nombre de la empresa ni el texto sin tratamientos', () => {
    for (const t of ['Clínica Dental Sol, S.L. en Sevilla', 'Tenemos 3 consultas y sala de espera', 'Policlínica San José, abierta de lunes a viernes']) {
      expect(redactPersonalData(t)).toBe(t);
    }
  });

  it('un nombre no se extiende a la línea siguiente (no se borra contenido que no es un nombre)', () => {
    expect(redactPersonalData('Atiende la Dra. María López\nTenemos 3 Consultas Dentales')).toBe(`Atiende la ${PERSONA}\nTenemos 3 Consultas Dentales`);
  });

  it('sustituye los emails personales y conserva los genéricos', () => {
    const t = 'Escríbenos a info@clinicasol.es o a juan.perez@gmail.com o a maria@clinicasol.es';
    expect(redactPersonalData(t)).toBe(`Escríbenos a info@clinicasol.es o a ${EMAIL_PERSONAL} o a ${EMAIL_PERSONAL}`);
  });
});

describe('classifyEmail (REQ-ENR-03): genérico de empresa o personal (se descarta)', () => {
  it.each(['info@clinicasol.es', 'contacto@clinicasol.es', 'recepcion@clinicasol.es', 'citas2@clinicasol.es', 'administracion@clinicasol.es', 'clinicasol@clinicasol.es', 'Info@ClinicaSol.es', 'info@gmail.com'])(
    '%s → generic_email', (e) => expect(classifyEmail(e)).toBe('generic_email'));

  it.each(['maria@clinicasol.es', 'juan.perez@clinicasol.es', 'juan_perez@clinicasol.es', 'jperez@clinicasol.es', 'clinicasol.sevilla@gmail.com', 'carlos@hotmail.com'])(
    '%s → personal_email', (e) => expect(classifyEmail(e)).toBe('personal_email'));

  it('un valor que no es un email se considera personal (se descarta por precaución)', () => {
    expect(classifyEmail('no es un email')).toBe('personal_email');
  });
});

describe('containsPersonName: red de seguridad sobre lo que devuelve el modelo', () => {
  it('detecta tratamiento + nombre aunque el modelo lo reintroduzca', () => {
    expect(containsPersonName('Dr. Luis Mora')).toBe(true);
    expect(containsPersonName('contacta con Dña. Ana')).toBe(true);
  });
  it('no marca nombres de empresa, direcciones ni cifras', () => {
    for (const v of ['Clínica Dental Sol', 'Calle Sierpes 12, 41004 Sevilla', '3 consultas', 'Lunes a viernes de 9 a 20 h', 'Doctor Sol Clínica']) {
      expect(containsPersonName(v), v).toBe(v === 'Doctor Sol Clínica');
    }
  });
});

describe('isBusinessWebmail (P2.3): buzón webmail del propio negocio, solo para el alta manual del revisor', () => {
  it.each([
    ['peluqueriaarcoiris@gmail.com', 'Peluquería Arcoíris'],
    ['arcoiris.pelu@hotmail.es', 'Peluquería Arcoíris S.L.'],
    ['dem_peluqueros@outlook.com', 'DEM Peluqueros'],
    ['encarnamoreno@gmail.com', 'Peluquería Encarna Moreno'], // el nombre comercial del autónomo es el del negocio (P2.4)
  ])('%s es el buzón de «%s»', (e, n) => expect(isBusinessWebmail(e, n)).toBe(true));

  it.each([
    ['maria.garcia@gmail.com', 'Peluquería Arcoíris'], // empleada: nada que ver con el negocio
    ['peluqueriamaria@gmail.com', 'Peluquería Ruiz'], // solo coincide la palabra del sector, no la marca
    ['info@arcoiris.es', 'Peluquería Arcoíris'], // no es webmail (ese caso ya lo cubre classifyEmail)
    ['arcoiris', 'Peluquería Arcoíris'],
  ])('%s NO es el buzón de «%s»', (e, n) => expect(isBusinessWebmail(e, n)).toBe(false));
});
