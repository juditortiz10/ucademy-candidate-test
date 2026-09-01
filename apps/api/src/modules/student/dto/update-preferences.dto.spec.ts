import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdatePreferencesDto } from './update-preferences.dto';

describe('UpdatePreferencesDto', () => {
  /**
   * ✅ TEST QUE PASA - Valida que se aceptan valores válidos
   */
  it('should accept valid theme values', async () => {
    const dto = plainToInstance(UpdatePreferencesDto, { theme: 'dark' });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  /**
   * ✅ TEST QUE PASA - Valida que se rechazan valores inválidos
   */
  it('should reject invalid theme values', async () => {
    const dto = plainToInstance(UpdatePreferencesDto, { theme: 'invalid' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('isIn');
  });

  /**
   * ✅ TEST QUE PASA - Valida DTO vacío (todos campos opcionales)
   */
  it('should accept empty dto', async () => {
    const dto = plainToInstance(UpdatePreferencesDto, {});
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  /**
   * ✅ TEST QUE PASA - Valida campo notifications como booleano
   */
  it('should accept boolean notifications', async () => {
    const dto = plainToInstance(UpdatePreferencesDto, { notifications: true });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should reject non-boolean notifications', async () => {
    const dto = plainToInstance(UpdatePreferencesDto, { notifications: 'si' });
    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('notifications');
    expect(errors[0].constraints).toHaveProperty('isBoolean');
  });

  it('should accept valid language string', async () => {
    const dto = plainToInstance(UpdatePreferencesDto, { language: 'en' });
    const errors = await validate(dto);

    expect(errors.length).toBe(0);
  });

  it('should reject non-string language', async () => {
    const dto = plainToInstance(UpdatePreferencesDto, { language: 42 });
    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('isString');
  });

  it('should accept multiple valid fields', async () => {
    const dto = plainToInstance(UpdatePreferencesDto, {
      theme: 'light',
      language: 'es',
      notifications: false,
    });
    const errors = await validate(dto);

    expect(errors.length).toBe(0);
    expect(dto).toEqual({ theme: 'light', language: 'es', notifications: false });
  });

  it('should report every invalid field at once', async () => {
    const dto = plainToInstance(UpdatePreferencesDto, {
      theme: 'neon',
      notifications: 'quizás',
    });
    const errors = await validate(dto);

    expect(errors.map((error) => error.property).sort()).toEqual(['notifications', 'theme']);
  });

  it('should accept the two supported themes', async () => {
    for (const theme of ['light', 'dark']) {
      const dto = plainToInstance(UpdatePreferencesDto, { theme });
      await expect(validate(dto)).resolves.toHaveLength(0);
    }
  });
});
