import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsEnum } from 'class-validator';
import { BulkOperation } from '../enums/bulk-operation.enum';
import { Transform } from 'class-transformer';

export class BatchProcessDto {
  @ApiProperty({
    example: ['uuid-1', 'uuid-2'],
    description: 'Task IDs to process',
  })
  @IsArray()
  @Transform(({ value }) => value)
  tasks: string[];

  @ApiProperty({
    example: 'complete',
    enum: ['complete', 'delete'],
    description: 'Action to perform on tasks',
  })
  @IsEnum(BulkOperation)
  action: BulkOperation;
}
