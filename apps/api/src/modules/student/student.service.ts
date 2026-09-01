import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Student, StudentDocument } from './schemas/student.schema';
import { Course, CourseDocument } from './schemas/course.schema';
import { Progress, ProgressDocument } from './schemas/progress.schema';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';

export interface StudentChatContext {
  name: string;
  currentCourse?: string;
  progress?: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ACTIVITY_WINDOW_DAYS = 7;

@Injectable()
export class StudentService {
  private readonly logger = new Logger(StudentService.name);

  constructor(
    @InjectModel(Student.name) private studentModel: Model<StudentDocument>,
    @InjectModel(Course.name) private courseModel: Model<CourseDocument>,
    @InjectModel(Progress.name) private progressModel: Model<ProgressDocument>
  ) {}

  /**
   * ✅ IMPLEMENTADO - Obtiene los datos del dashboard
   */
  async getDashboard(studentId: string) {
    if (!Types.ObjectId.isValid(studentId)) return null;

    const student = await this.studentModel.findById(studentId).lean();
    if (!student) return null;

    const progressRecords = await this.progressModel
      .find({ studentId: new Types.ObjectId(studentId) })
      .lean();

    const totalCourses = progressRecords.length;
    const completedCourses = progressRecords.filter(
      (p) => p.progressPercentage === 100
    ).length;
    const inProgressCourses = progressRecords.filter(
      (p) => p.progressPercentage > 0 && p.progressPercentage < 100
    ).length;
    const totalTimeSpent = progressRecords.reduce(
      (acc, p) => acc + (p.timeSpentMinutes || 0),
      0
    );

    // Obtener cursos recientes (últimos 3 accedidos)
    const recentProgress = await this.progressModel
      .find({ studentId: new Types.ObjectId(studentId) })
      .sort({ lastAccessedAt: -1 })
      .limit(3)
      .populate('courseId')
      .lean();

    const recentCourses = recentProgress.map((p) => ({
      course: p.courseId,
      progress: p.progressPercentage,
      lastAccessed: p.lastAccessedAt,
    }));

    return {
      student: {
        id: student._id,
        name: student.name,
        email: student.email,
        avatar: student.avatar,
        preferences: student.preferences,
      },
      stats: {
        totalCourses,
        completedCourses,
        inProgressCourses,
        totalTimeSpentMinutes: totalTimeSpent,
        totalTimeSpentFormatted: this.formatTime(totalTimeSpent),
      },
      recentCourses,
    };
  }

  /**
   * ✅ IMPLEMENTADO - Obtiene cursos con progreso
   */
  async getCoursesWithProgress(studentId: string) {
    const courses = await this.courseModel.find().lean();
    const progressRecords = await this.progressModel
      .find({ studentId: new Types.ObjectId(studentId) })
      .lean();

    const progressMap = new Map(
      progressRecords.map((p) => [p.courseId.toString(), p])
    );

    return courses.map((course) => {
      const progress = progressMap.get(course._id.toString());
      return {
        ...course,
        progress: progress
          ? {
              completedLessons: progress.completedLessons,
              progressPercentage: progress.progressPercentage,
              lastAccessedAt: progress.lastAccessedAt,
              timeSpentMinutes: progress.timeSpentMinutes,
            }
          : null,
      };
    });
  }

  /**
   * Estadísticas detalladas del estudiante.
   *
   * Nota sobre los datos disponibles: el modelo `Progress` guarda un único
   * `lastAccessedAt` por curso, no un log de sesiones. La racha y la actividad
   * diaria se derivan de esas marcas (ver DECISIONS.md).
   */
  async getDetailedStats(studentId: string) {
    if (!Types.ObjectId.isValid(studentId)) {
      throw new NotFoundException(`Estudiante con ID ${studentId} no encontrado`);
    }

    const student = await this.studentModel.findById(studentId).lean();
    if (!student) {
      throw new NotFoundException(`Estudiante con ID ${studentId} no encontrado`);
    }

    const studentObjectId = new Types.ObjectId(studentId);

    const [progressRecords, timeByCategory] = await Promise.all([
      this.progressModel.find({ studentId: studentObjectId }).lean(),
      this.aggregateTimeByCategory(studentObjectId),
    ]);

    const totalCourses = progressRecords.length;
    const completedCourses = progressRecords.filter((p) => p.progressPercentage >= 100).length;
    const inProgressCourses = progressRecords.filter(
      (p) => p.progressPercentage > 0 && p.progressPercentage < 100
    ).length;
    const notStartedCourses = totalCourses - completedCourses - inProgressCourses;

    const totalTimeSpentMinutes = progressRecords.reduce(
      (acc, p) => acc + (p.timeSpentMinutes || 0),
      0
    );
    const totalLessonsCompleted = progressRecords.reduce(
      (acc, p) => acc + (p.completedLessons || 0),
      0
    );
    const totalProgressPoints = progressRecords.reduce(
      (acc, p) => acc + (p.progressPercentage || 0),
      0
    );

    const accessDates = progressRecords
      .map((p) => p.lastAccessedAt)
      .filter((date): date is Date => !!date);

    const streak = this.calculateStreak(accessDates);

    return {
      studentId,
      totals: {
        totalCourses,
        completedCourses,
        inProgressCourses,
        notStartedCourses,
        totalLessonsCompleted,
        totalTimeSpentMinutes,
        totalTimeSpentHours: Number((totalTimeSpentMinutes / 60).toFixed(2)),
        totalTimeSpentFormatted: this.formatTime(totalTimeSpentMinutes),
        overallProgressPercentage:
          totalCourses > 0 ? Math.round(totalProgressPoints / totalCourses) : 0,
        completionRate:
          totalCourses > 0 ? Math.round((completedCourses / totalCourses) * 100) : 0,
      },
      streak,
      weeklyProgress: this.calculateWeeklyProgress(
        totalProgressPoints,
        totalTimeSpentMinutes,
        student.createdAt,
      ),
      timeByCategory,
      // Serie para el gráfico de actividad del dashboard (últimos 7 días).
      activityByDay: this.buildActivitySeries(progressRecords),
    };
  }

  /**
   * Distribución de tiempo por categoría de curso.
   * Se resuelve con una agregación: el join con `courses` y la suma ocurren
   * en la base de datos, no en Node.
   */
  private async aggregateTimeByCategory(studentId: Types.ObjectId) {
    const rows = await this.progressModel.aggregate<{
      category: string;
      timeSpentMinutes: number;
      courses: number;
      lessonsCompleted: number;
    }>([
      { $match: { studentId } },
      {
        $lookup: {
          from: this.courseModel.collection.name,
          localField: 'courseId',
          foreignField: '_id',
          as: 'course',
        },
      },
      { $unwind: '$course' },
      {
        $group: {
          _id: '$course.category',
          timeSpentMinutes: { $sum: { $ifNull: ['$timeSpentMinutes', 0] } },
          courses: { $sum: 1 },
          lessonsCompleted: { $sum: { $ifNull: ['$completedLessons', 0] } },
        },
      },
      {
        $project: {
          _id: 0,
          category: '$_id',
          timeSpentMinutes: 1,
          courses: 1,
          lessonsCompleted: 1,
        },
      },
      { $sort: { timeSpentMinutes: -1, category: 1 } },
    ]);

    const total = rows.reduce((acc, row) => acc + row.timeSpentMinutes, 0);

    return rows.map((row) => ({
      ...row,
      timeSpentFormatted: this.formatTime(row.timeSpentMinutes),
      percentage: total > 0 ? Math.round((row.timeSpentMinutes / total) * 100) : 0,
    }));
  }

  /**
   * Racha de días consecutivos de estudio a partir de las fechas de acceso.
   * La racha sigue viva si el último acceso fue hoy o ayer.
   */
  private calculateStreak(accessDates: Date[]) {
    if (accessDates.length === 0) {
      return {
        currentStreakDays: 0,
        longestStreakDays: 0,
        lastStudyDate: null,
        studiedToday: false,
      };
    }

    // Días únicos (a medianoche local), de más reciente a más antiguo.
    const uniqueDays = [...new Set(accessDates.map((date) => this.startOfDay(date).getTime()))].sort(
      (a, b) => b - a
    );

    const today = this.startOfDay(new Date()).getTime();
    const daysSinceLastStudy = Math.round((today - uniqueDays[0]) / MS_PER_DAY);

    let currentStreakDays = 0;
    if (daysSinceLastStudy <= 1) {
      currentStreakDays = 1;
      for (let i = 1; i < uniqueDays.length; i++) {
        if (Math.round((uniqueDays[i - 1] - uniqueDays[i]) / MS_PER_DAY) === 1) {
          currentStreakDays++;
        } else {
          break;
        }
      }
    }

    let longestStreakDays = 1;
    let run = 1;
    for (let i = 1; i < uniqueDays.length; i++) {
      if (Math.round((uniqueDays[i - 1] - uniqueDays[i]) / MS_PER_DAY) === 1) {
        run++;
      } else {
        run = 1;
      }
      longestStreakDays = Math.max(longestStreakDays, run);
    }

    return {
      currentStreakDays,
      longestStreakDays,
      lastStudyDate: new Date(uniqueDays[0]),
      studiedToday: uniqueDays[0] === today,
    };
  }

  /**
   * Promedio de progreso semanal desde que el estudiante se registró.
   */
  private calculateWeeklyProgress(
    totalProgressPoints: number,
    totalTimeSpentMinutes: number,
    createdAt?: Date
  ) {
    const start = createdAt ? new Date(createdAt).getTime() : Date.now();
    const elapsedWeeks = Math.max(1, (Date.now() - start) / (7 * MS_PER_DAY));

    return {
      weeksSinceStart: Number(elapsedWeeks.toFixed(1)),
      averageProgressPointsPerWeek: Number((totalProgressPoints / elapsedWeeks).toFixed(1)),
      averageMinutesPerWeek: Math.round(totalTimeSpentMinutes / elapsedWeeks),
    };
  }

  /**
   * Serie de actividad de los últimos 7 días.
   *
   * Aproximación consciente: sin log de sesiones, el tiempo de cada curso se
   * imputa al día de su `lastAccessedAt`. Los días sin acceso salen a 0.
   */
  private buildActivitySeries(progressRecords: Array<{ lastAccessedAt?: Date; timeSpentMinutes?: number }>) {
    const minutesByDay = new Map<number, number>();

    for (const record of progressRecords) {
      if (!record.lastAccessedAt) continue;
      const day = this.startOfDay(record.lastAccessedAt).getTime();
      minutesByDay.set(day, (minutesByDay.get(day) ?? 0) + (record.timeSpentMinutes ?? 0));
    }

    const today = this.startOfDay(new Date()).getTime();
    const series: Array<{ date: string; label: string; minutes: number; hours: number }> = [];

    for (let offset = ACTIVITY_WINDOW_DAYS - 1; offset >= 0; offset--) {
      const day = today - offset * MS_PER_DAY;
      const minutes = minutesByDay.get(day) ?? 0;
      const date = new Date(day);

      series.push({
        date: date.toISOString().slice(0, 10),
        label: date.toLocaleDateString('es-ES', { weekday: 'short' }),
        minutes,
        hours: Number((minutes / 60).toFixed(2)),
      });
    }

    return series;
  }

  /**
   * Actualiza las preferencias del estudiante con merge parcial: solo se
   * escriben los campos presentes en el DTO, el resto se conserva.
   */
  async updatePreferences(studentId: string, dto: UpdatePreferencesDto) {
    if (!Types.ObjectId.isValid(studentId)) {
      throw new NotFoundException(`Estudiante con ID ${studentId} no encontrado`);
    }

    // Notación por puntos: `preferences.theme` actualiza esa clave sin
    // sobrescribir el resto del subdocumento.
    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(dto)) {
      if (value !== undefined) {
        updates[`preferences.${key}`] = value;
      }
    }

    if (Object.keys(updates).length === 0) {
      throw new BadRequestException('No se ha proporcionado ninguna preferencia a actualizar');
    }

    const student = await this.studentModel
      .findByIdAndUpdate(studentId, { $set: updates }, { new: true, runValidators: true })
      .lean();

    if (!student) {
      throw new NotFoundException(`Estudiante con ID ${studentId} no encontrado`);
    }

    this.logger.log(`Preferencias actualizadas para ${studentId}: ${Object.keys(updates).join(', ')}`);

    return {
      id: student._id,
      name: student.name,
      email: student.email,
      avatar: student.avatar,
      preferences: student.preferences,
    };
  }

  /**
   * Contexto ligero del estudiante para personalizar el prompt del asistente.
   */
  async getChatContext(studentId: string): Promise<StudentChatContext | null> {
    if (!Types.ObjectId.isValid(studentId)) return null;

    const student = await this.studentModel.findById(studentId).lean();
    if (!student) return null;

    const [currentProgress] = await this.progressModel
      .find({ studentId: new Types.ObjectId(studentId), lastAccessedAt: { $ne: null } })
      .sort({ lastAccessedAt: -1 })
      .limit(1)
      .populate<{ courseId: CourseDocument }>('courseId')
      .lean();

    return {
      name: student.name,
      currentCourse: currentProgress?.courseId?.title,
      progress: currentProgress?.progressPercentage,
    };
  }

  /**
   * Helper para formatear tiempo
   */
  private formatTime(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours === 0) return `${mins}m`;
    return `${hours}h ${mins}m`;
  }

  /** Normaliza una fecha a medianoche local, para comparar por días */
  private startOfDay(date: Date): Date {
    const normalized = new Date(date);
    normalized.setHours(0, 0, 0, 0);
    return normalized;
  }

  /**
   * Método auxiliar para buscar un estudiante por ID
   */
  async findById(id: string) {
    return this.studentModel.findById(id).lean();
  }
}
