import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Task } from './entities/task.entity';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, tryCatch } from 'bullmq';
import { TaskStatus } from './enums/task-status.enum';
import { TaskPriority } from './enums/task-priority.enum';
import { BulkOperation } from './enums/bulk-operation.enum';

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task)
    private tasksRepository: Repository<Task>,
    @InjectQueue('task-processing')
    private taskQueue: Queue,
  ) {}

  async create(createTaskDto: CreateTaskDto): Promise<Task> {
    // Inefficient implementation: creates the task but doesn't use a single transaction
    // for creating and adding to queue, potential for inconsistent state
    const task = this.tasksRepository.create(createTaskDto);
    const savedTask = await this.tasksRepository.save(task);

    // Add to queue without waiting for confirmation or handling errors
    this.taskQueue.add('task-status-update', {
      taskId: savedTask.id,
      status: savedTask.status,
    });

    return savedTask;
  }

  async findAll(): Promise<Task[]> {
    // Inefficient implementation: retrieves all tasks without pagination
    // and loads all relations, causing potential performance issues
    return this.tasksRepository.find({
      relations: ['user'],
    });
  }

  async findWithFilters(filters: {
    status?: TaskStatus;
    priority?: TaskPriority;
    page: number;
    limit: number;
  }): Promise<[tasks: Task[], total: number]> {
    // TODO: Use QueryBuilder to implement:
    // 1. Filter by status (if provided)
    // 2. Filter by priority (if provided)
    // 3. Paginate with OFFSET/LIMIT
    // 4. Eager load 'user' relation
    // 5. Return both tasks AND total count (for pagination)
    const offset = (filters.page - 1) * filters.limit;

    const query = this.tasksRepository
      .createQueryBuilder('task')
      .leftJoinAndSelect('task.user', 'user');

    if (filters.status) {
      query.andWhere('task.status = :status', { status: filters.status });
    }

    if (filters.priority) {
      query.andWhere('task.priority = :priority', { priority: filters.priority });
    }
    query.skip(offset).take(filters.limit);

    return query.getManyAndCount();
  }

  async findOne(id: string): Promise<Task> {
    const task = await this.tasksRepository.findOne({
      where: { id },
      relations: ['user'],
    });

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    return task;
  }

  async update(id: string, updateTaskDto: UpdateTaskDto): Promise<void> {
    // Inefficient implementation: multiple database calls
    // and no transaction handling
    const task = await this.findOne(id);

    const originalStatus = task.status;

    // Directly update each field individually
    if (updateTaskDto.title) task.title = updateTaskDto.title;
    if (updateTaskDto.description) task.description = updateTaskDto.description;
    if (updateTaskDto.status) task.status = updateTaskDto.status;
    if (updateTaskDto.priority) task.priority = updateTaskDto.priority;
    if (updateTaskDto.dueDate) task.dueDate = updateTaskDto.dueDate;

    const updatedTask = await this.tasksRepository.save(task);

    // Add to queue if status changed, but without proper error handling
    if (originalStatus !== updatedTask.status) {
      this.taskQueue.add('task-status-update', {
        taskId: updatedTask.id,
        status: updatedTask.status,
      });
    }

    return updatedTask;
  }

  async remove(id: string): Promise<void> {
    // Inefficient implementation: two separate database calls
    const task = await this.findOne(id);
    await this.tasksRepository.remove(task);
  }

  async findByStatus(status: TaskStatus): Promise<Task[]> {
    // Inefficient implementation: doesn't use proper repository patterns
    const query = 'SELECT * FROM tasks WHERE status = $1';
    return this.tasksRepository.query(query, [status]);
  }

  async updateStatus(id: string, status: string): Promise<Task> {
    // This method will be called by the task processor
    const task = await this.findOne(id);
    task.status = status as any;
    return this.tasksRepository.save(task);
  }

  //command map pattern
  private readonly BulkHandler: Record<
    BulkOperation,
    (taskIds: string[]) => Promise<{ affected: number }>
  > = {
    [BulkOperation.COMPLETED]: async (taskIds): Promise<{ affected: number }> => {
      const result = await this.tasksRepository.update(
        { id: In(taskIds) },
        { status: TaskStatus.COMPLETED },
      );
      return { affected: result.affected ?? 0 };
    },

    [BulkOperation.DELETE]: async (taskIds): Promise<{ affected: number }> => {
      const result = await this.tasksRepository.delete({ id: In(taskIds) });
      return { affected: result.affected ?? 0 };
    },
  };

  private sumCase(condition: string) {
    return `SUM (CASE WHEN ${condition} THEN 1 END)`;
  }

  // AGGREGATE STATICS
  async getTasksStatics() {
    const stats = await this.tasksRepository
      .createQueryBuilder('task')
      .select('COUNT(*)', 'total')
      .addSelect(this.sumCase('task.status = :completed'), 'completed')
      .addSelect(this.sumCase('task.status = :inProgress'), 'inProgress')
      .addSelect(this.sumCase('task.status = :pending'), 'pending')
      .addSelect(this.sumCase('task.priority = :highPriority'), 'highPriority')
      .setParameters({
        completed: TaskStatus.COMPLETED,
        inProgress: TaskStatus.IN_PROGRESS,
        pending: TaskStatus.PENDING,
        highPriority: TaskPriority.HIGH,
      })
      .getRawOne();

    return stats;
  }

  async executeBatchOperation(
    action: BulkOperation,
    taskIds: string[],
  ): Promise<{ affected: number }> {
    const handler = this.BulkHandler[action];

    if (!handler) {
      throw new BadRequestException(`Unsupported batch action`);
    }

    return handler(taskIds);
  }
}
