import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { equals, IsEmail, IsNotEmpty, IsOptional, IsPhoneNumber, IsString, Length, IsInt } from "class-validator";
import { UserRole } from "../user.entity";

// TODO: Again: Custom decorators for address and signature,...
export class UpdateUserDto {

    @IsOptional()
    @IsInt()
    id: number;

    @IsNotEmpty()
    @Length(34,34)
    @IsString()
    address: string;

    @IsNotEmpty()
    @Length(88,88)
    @IsString()
    signature: string;

    @IsOptional()
    @IsString()
    ref: string;

    @ApiProperty()
    @IsOptional()
    @IsString()
    usedRef: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsInt()
    walletId: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsEmail()
    mail: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    firstname: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    surname: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    street: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    houseNumber: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    location: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    zip: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    country: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    // TODO: user phonenumber decorator instead of string --> Figure it out
    // @IsPhoneNumber()
    phone: string;

    @IsOptional()
    @IsString()
    role: UserRole;

    @IsOptional()
    @IsString()
    ip: string;

    @IsOptional()
    @IsString()
    status: string;
}