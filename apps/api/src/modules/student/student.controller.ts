import { Controller, Get, Patch, Param, Body, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { StudentService } from './student.service';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';

@ApiTags('students')
@Controller('students')
export class StudentController {
  constructor(private readonly studentService: StudentService) {}

  /**
   * ✅ IMPLEMENTADO - Endpoint del dashboard principal
   * Retorna información resumida del estudiante para el dashboard
   */
  @Get(':id/dashboard')
  @ApiOperation({ summary: 'Obtener datos del dashboard del estudiante' })
  @ApiParam({ name: 'id', description: 'ID del estudiante' })
  @ApiResponse({ status: 200, description: 'Datos del dashboard' })
  @ApiResponse({ status: 404, description: 'Estudiante no encontrado' })
  async getDashboard(@Param('id') id: string) {
    const dashboard = await this.studentService.getDashboard(id);
    if (!dashboard) {
      throw new NotFoundException(`Estudiante con ID ${id} no encontrado`);
    }
    return dashboard;
  }

  /**
   * ✅ IMPLEMENTADO - Obtener cursos del estudiante con progreso
   */
  @Get(':id/courses')
  @ApiOperation({ summary: 'Obtener cursos del estudiante con progreso' })
  @ApiParam({ name: 'id', description: 'ID del estudiante' })
  @ApiResponse({ status: 200, description: 'Lista de cursos con progreso' })
  async getCourses(@Param('id') id: string) {
    return this.studentService.getCoursesWithProgress(id);
  }

  /**
   * Estadísticas detalladas: tiempo total, cursos por estado, racha de días
   * consecutivos, progreso semanal medio y distribución por categoría.
   */
  @Get(':id/stats')
  @ApiOperation({ summary: 'Obtener estadísticas detalladas del estudiante' })
  @ApiParam({ name: 'id', description: 'ID del estudiante' })
  @ApiResponse({ status: 200, description: 'Estadísticas del estudiante' })
  @ApiResponse({ status: 404, description: 'Estudiante no encontrado' })
  async getStats(@Param('id') id: string) {
    return this.studentService.getDetailedStats(id);
  }

  /**
   * Actualiza las preferencias del estudiante (merge parcial).
   * La validación de los valores la aplica el ValidationPipe global vía DTO.
   */
  @Patch(':id/preferences')
  @ApiOperation({ summary: 'Actualizar preferencias del estudiante' })
  @ApiParam({ name: 'id', description: 'ID del estudiante' })
  @ApiResponse({ status: 200, description: 'Preferencias actualizadas' })
  @ApiResponse({ status: 400, description: 'Preferencias inválidas' })
  @ApiResponse({ status: 404, description: 'Estudiante no encontrado' })
  async updatePreferences(
    @Param('id') id: string,
    @Body() updatePreferencesDto: UpdatePreferencesDto
  ) {
    return this.studentService.updatePreferences(id, updatePreferencesDto);
  }
}
