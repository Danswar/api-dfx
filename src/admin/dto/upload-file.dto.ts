import { IsEnum, IsNotEmpty, IsNumber, IsString } from 'class-validator';
import { KycDocument } from 'src/user/services/spider/dto/spider.dto';

export class UploadFileDto {
  @IsNotEmpty()
  @IsNumber()
  userDataId: number;

  @IsNotEmpty()
  @IsEnum(KycDocument)
  documentType: KycDocument;

  @IsNotEmpty()
  @IsString()
  originalName: string;

  @IsNotEmpty()
  @IsString()
  contentType: string;

  @IsNotEmpty()
  @IsString()
  data: string;
}
