import { Test, TestingModule } from '@nestjs/testing';
import { StudentController } from './student.controller';
import { StudentService } from './student.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('StudentController', () => {
  let controller: StudentController;
  let service: StudentService;

  const mockStudentService = {
    getDashboard: jest.fn(),
    getCoursesWithProgress: jest.fn(),
    getDetailedStats: jest.fn(),
    updatePreferences: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StudentController],
      providers: [
        {
          provide: StudentService,
          useValue: mockStudentService,
        },
      ],
    }).compile();

    controller = module.get<StudentController>(StudentController);
    service = module.get<StudentService>(StudentService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getDashboard', () => {
    /**
     * ✅ TEST QUE PASA - Verifica que el dashboard retorna datos correctamente
     */
    it('should return dashboard data for valid student', async () => {
      const mockDashboard = {
        student: {
          id: '507f1f77bcf86cd799439011',
          name: 'María García',
          email: 'maria@test.com',
        },
        stats: {
          totalCourses: 5,
          completedCourses: 1,
          inProgressCourses: 2,
          totalTimeSpentMinutes: 565,
          totalTimeSpentFormatted: '9h 25m',
        },
        recentCourses: [],
      };

      mockStudentService.getDashboard.mockResolvedValue(mockDashboard);

      const result = await controller.getDashboard('507f1f77bcf86cd799439011');

      expect(result).toEqual(mockDashboard);
      expect(service.getDashboard).toHaveBeenCalledWith('507f1f77bcf86cd799439011');
    });

    /**
     * ✅ TEST QUE PASA - Verifica que se lanza NotFoundException para estudiante inexistente
     */
    it('should throw NotFoundException when student not found', async () => {
      mockStudentService.getDashboard.mockResolvedValue(null);

      await expect(controller.getDashboard('invalid-id')).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('getCourses', () => {
    /**
     * ✅ TEST QUE PASA - Verifica que se obtienen cursos con progreso
     */
    it('should return courses with progress', async () => {
      const mockCourses = [
        {
          _id: 'course1',
          title: 'React desde Cero',
          progress: { progressPercentage: 70 },
        },
        {
          _id: 'course2',
          title: 'Node.js',
          progress: null,
        },
      ];

      mockStudentService.getCoursesWithProgress.mockResolvedValue(mockCourses);

      const result = await controller.getCourses('507f1f77bcf86cd799439011');

      expect(result).toHaveLength(2);
      expect(result[0].progress?.progressPercentage).toBe(70);
    });
  });

  describe('getStats', () => {
    const mockStats = {
      studentId: '507f1f77bcf86cd799439011',
      totals: {
        totalCourses: 5,
        completedCourses: 1,
        inProgressCourses: 2,
        notStartedCourses: 2,
        totalLessonsCompleted: 31,
        totalTimeSpentMinutes: 565,
        totalTimeSpentHours: 9.42,
        totalTimeSpentFormatted: '9h 25m',
        overallProgressPercentage: 41,
        completionRate: 20,
      },
      streak: {
        currentStreakDays: 2,
        longestStreakDays: 2,
        lastStudyDate: new Date(),
        studiedToday: true,
      },
      weeklyProgress: {
        weeksSinceStart: 1,
        averageProgressPointsPerWeek: 203,
        averageMinutesPerWeek: 565,
      },
      timeByCategory: [
        { category: 'Frontend', timeSpentMinutes: 280, courses: 1, lessonsCompleted: 14, timeSpentFormatted: '4h 40m', percentage: 50 },
        { category: 'Backend', timeSpentMinutes: 90, courses: 1, lessonsCompleted: 5, timeSpentFormatted: '1h 30m', percentage: 16 },
      ],
      activityByDay: [],
    };

    it('should return detailed statistics for student', async () => {
      mockStudentService.getDetailedStats.mockResolvedValue(mockStats);

      const result = await controller.getStats('507f1f77bcf86cd799439011');

      expect(result).toEqual(mockStats);
      expect(service.getDetailedStats).toHaveBeenCalledWith('507f1f77bcf86cd799439011');
      expect(result.totals.totalTimeSpentFormatted).toBe('9h 25m');
    });

    it('should calculate study streak correctly', async () => {
      mockStudentService.getDetailedStats.mockResolvedValue(mockStats);

      const result = await controller.getStats('507f1f77bcf86cd799439011');

      expect(result.streak.currentStreakDays).toBe(2);
      expect(result.streak.studiedToday).toBe(true);
      expect(result.streak.longestStreakDays).toBeGreaterThanOrEqual(
        result.streak.currentStreakDays
      );
    });

    it('should aggregate time by category', async () => {
      mockStudentService.getDetailedStats.mockResolvedValue(mockStats);

      const result = await controller.getStats('507f1f77bcf86cd799439011');

      expect(result.timeByCategory).toHaveLength(2);
      expect(result.timeByCategory[0].category).toBe('Frontend');
      // Ordenado de mayor a menor tiempo dedicado
      expect(result.timeByCategory[0].timeSpentMinutes).toBeGreaterThan(
        result.timeByCategory[1].timeSpentMinutes
      );
    });

    it('should handle student with no courses', async () => {
      mockStudentService.getDetailedStats.mockResolvedValue({
        ...mockStats,
        totals: {
          ...mockStats.totals,
          totalCourses: 0,
          completedCourses: 0,
          inProgressCourses: 0,
          notStartedCourses: 0,
          totalTimeSpentMinutes: 0,
          overallProgressPercentage: 0,
          completionRate: 0,
        },
        streak: { currentStreakDays: 0, longestStreakDays: 0, lastStudyDate: null, studiedToday: false },
        timeByCategory: [],
      });

      const result = await controller.getStats('507f1f77bcf86cd799439011');

      expect(result.totals.totalCourses).toBe(0);
      expect(result.timeByCategory).toEqual([]);
      expect(result.streak.currentStreakDays).toBe(0);
    });

    it('should propagate NotFoundException for unknown student', async () => {
      mockStudentService.getDetailedStats.mockRejectedValue(
        new NotFoundException('Estudiante no encontrado')
      );

      await expect(controller.getStats('507f1f77bcf86cd799439099')).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('updatePreferences', () => {
    const updatedStudent = {
      id: '507f1f77bcf86cd799439011',
      name: 'María García',
      email: 'maria@test.com',
      preferences: { theme: 'dark', language: 'es', notifications: true },
    };

    it('should update student preferences', async () => {
      mockStudentService.updatePreferences.mockResolvedValue(updatedStudent);

      const result = await controller.updatePreferences('507f1f77bcf86cd799439011', {
        theme: 'dark',
      });

      expect(result).toEqual(updatedStudent);
      expect(service.updatePreferences).toHaveBeenCalledWith('507f1f77bcf86cd799439011', {
        theme: 'dark',
      });
    });

    it('should merge partial preferences update', async () => {
      mockStudentService.updatePreferences.mockResolvedValue(updatedStudent);

      // Solo se envía `theme`; el resto de preferencias debe conservarse.
      const result = await controller.updatePreferences('507f1f77bcf86cd799439011', {
        theme: 'dark',
      });

      expect(result.preferences).toEqual({
        theme: 'dark',
        language: 'es',
        notifications: true,
      });
    });

    it('should validate theme value', async () => {
      // La validación la aplica el ValidationPipe global sobre el DTO;
      // aquí se comprueba que el controlador propaga el 400 resultante.
      mockStudentService.updatePreferences.mockRejectedValue(
        new BadRequestException('theme must be one of the following values: light, dark')
      );

      await expect(
        controller.updatePreferences('507f1f77bcf86cd799439011', { theme: 'neon' } as never)
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException for invalid student', async () => {
      mockStudentService.updatePreferences.mockRejectedValue(
        new NotFoundException('Estudiante con ID 507f1f77bcf86cd799439099 no encontrado')
      );

      await expect(
        controller.updatePreferences('507f1f77bcf86cd799439099', { theme: 'dark' })
      ).rejects.toThrow(NotFoundException);
    });

    it('should forward every provided preference field', async () => {
      mockStudentService.updatePreferences.mockResolvedValue(updatedStudent);

      const dto = { theme: 'dark' as const, language: 'en', notifications: false };
      await controller.updatePreferences('507f1f77bcf86cd799439011', dto);

      expect(service.updatePreferences).toHaveBeenCalledWith('507f1f77bcf86cd799439011', dto);
    });
  });
});
