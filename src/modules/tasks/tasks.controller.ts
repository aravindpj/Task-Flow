import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
  HttpException,
  HttpStatus,
  UseInterceptors,
  ParseUUIDPipe,
} from '@nestjs/common';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Task } from './entities/task.entity';
import { TaskStatus } from './enums/task-status.enum';
import { TaskPriority } from './enums/task-priority.enum';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { BatchProcessDto } from './dto/batch-process.dto';
import { BulkOperation } from './enums/bulk-operation.enum';

// This guard needs to be implemented or imported from the correct location
// We're intentionally leaving it as a non-working placeholder
class JwtAuthGuard {}

@ApiTags('tasks')
@Controller('tasks')
@UseGuards(JwtAuthGuard, RateLimitGuard)
@RateLimit({ limit: 100, windowMs: 60000 })
@ApiBearerAuth()
export class TasksController {
  constructor(
    private readonly tasksService: TasksService,
    // Anti-pattern: Controller directly accessing repository
    @InjectRepository(Task)
    private taskRepository: Repository<Task>,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new task' })
  create(@Body() createTaskDto: CreateTaskDto) {
    return this.tasksService.create(createTaskDto);
  }

  @Get()
  @ApiOperation({ summary: 'Find all tasks with optional filtering' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'priority', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async findAll(
    @Query('status') status?: TaskStatus,
    @Query('priority') priority?: TaskPriority,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const safePage = Number(page) || 1;
    const safeLimit = Number(limit) || 10;

    const [tasks, total] = await this.tasksService.findWithFilters({
      status,
      priority,
      page: safePage,
      limit: safeLimit,
    });

    const totalPages = Math.ceil(total / safeLimit);

    return {
      success: true,
      data: tasks,
      count: tasks.length,
      meta: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages,
        hasNextPage: safePage < totalPages,
        hasPrevPage: safePage > 1,
        pagesLeft: Math.max(0, totalPages - safePage),
      },
    };
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get task statistics' })
  async getStats() {
    const stats = await this.tasksService.getTasksStatics();
    return {
      status: true,
      data: stats,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Find a task by ID' })
  async findOne(@Param('id') id: string) {
    const task = await this.tasksService.findOne(id);
    return {
      status: true,
      data: task,
    };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a task' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() updateTaskDto: UpdateTaskDto) {
    // No validation if task exists before update
    const updatedTask=await this.tasksService.update(id, updateTaskDto);
    return {
      status: true,
      data: updatedTask,
    };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a task' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.tasksService.remove(id);
  }

  @Post('batch')
  @ApiOperation({ summary: 'Batch process multiple tasks' })
  async batchProcess(@Body() batchProcessDto: BatchProcessDto) {
    const { tasks: taskIds, action } = batchProcessDto;
    const result = await this.tasksService.executeBatchOperation(action, taskIds);
    return {
      success: true,
      affected: result?.affected,
    };
  }
}
