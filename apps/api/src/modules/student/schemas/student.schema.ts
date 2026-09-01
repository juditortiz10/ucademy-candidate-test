import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type StudentDocument = Student & Document;

@Schema({ timestamps: true })
export class Student {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, unique: true })
  email: string;

  @Prop()
  avatar?: string;

  @Prop({ type: Object, default: {} })
  preferences: {
    theme?: 'light' | 'dark';
    language?: string;
    notifications?: boolean;
  };

  @Prop({ default: Date.now })
  lastActive: Date;

  // Los añade `timestamps: true`; se declaran para que estén tipados.
  createdAt?: Date;
  updatedAt?: Date;
}

export const StudentSchema = SchemaFactory.createForClass(Student);
