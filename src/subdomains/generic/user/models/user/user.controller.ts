import { Body, Controller, Delete, Get, HttpStatus, Param, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { RealIP } from 'nestjs-real-ip';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { HistoryFilter, HistoryFilterKey } from 'src/subdomains/core/history/dto/history-filter.dto';
import { KycInputDataDto } from 'src/subdomains/generic/kyc/dto/input/kyc-data.dto';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { AuthService } from '../auth/auth.service';
import { AuthResponseDto } from '../auth/dto/auth-response.dto';
import { UserDataService } from '../user-data/user-data.service';
import { ApiKeyDto } from './dto/api-key.dto';
import { LinkedUserInDto } from './dto/linked-user.dto';
import { RefInfoQuery } from './dto/ref-info-query.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { UpdateUserAdminDto } from './dto/update-user-admin.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserNameDto } from './dto/user-name.dto';
import { ReferralDto, UserV2Dto } from './dto/user-v2.dto';
import { UserDetailDto, UserDto } from './dto/user.dto';
import { VolumeQuery } from './dto/volume-query.dto';
import { User } from './user.entity';
import { UserService } from './user.service';

const AccountExistsResponse = {
  type: UserDetailDto,
  description:
    'There is already a verified account with the same mail address, a mail confirmation request has been sent',
};

@ApiTags('User')
@Controller('user')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly authService: AuthService,
    private readonly feeService: FeeService,
    private readonly userDataService: UserDataService,
  ) {}

  // --- USER --- //
  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: UserDto })
  @ApiOperation({ deprecated: true })
  async getUserV1(@GetJwt() jwt: JwtPayload): Promise<UserDto> {
    return this.userService.getUserDto(jwt.user, false);
  }

  @Get('detail')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: UserDetailDto })
  @ApiOperation({ deprecated: true })
  async getUserDetailV1(@GetJwt() jwt: JwtPayload): Promise<UserDetailDto> {
    return this.userService.getUserDto(jwt.user, true);
  }

  @Put()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: UserDetailDto })
  @ApiAcceptedResponse(AccountExistsResponse)
  @ApiOperation({ deprecated: true })
  async updateUserV1(
    @GetJwt() jwt: JwtPayload,
    @Body() newUser: UpdateUserDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserDetailDto> {
    const { user, isKnownUser } = await this.userService.updateUserV1(jwt.user, newUser);
    if (isKnownUser) res.status(HttpStatus.ACCEPTED);

    return user;
  }

  @Put('discountCodes')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse()
  @ApiOperation({ deprecated: true, description: 'This endpoint is deprecated, use "specialCodes" instead.' })
  async addDiscountCode(@GetJwt() jwt: JwtPayload, @Query('code') code: string): Promise<void> {
    const user = await this.userService.getUser(jwt.user, { userData: true, wallet: true });

    return this.feeService.addSpecialCodeUser(user, code);
  }

  @Put('specialCodes')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse()
  async addSpecialCode(@GetJwt() jwt: JwtPayload, @Query('code') code: string): Promise<void> {
    const user = await this.userService.getUser(jwt.user, { userData: true, wallet: true });

    return this.feeService.addSpecialCodeUser(user, code);
  }

  @Post('change')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT))
  @ApiOkResponse({ type: AuthResponseDto })
  async changeUser(
    @GetJwt() jwt: JwtPayload,
    @Body() changeUser: LinkedUserInDto,
    @RealIP() ip: string,
  ): Promise<AuthResponseDto> {
    return this.authService.changeUser(jwt.account, changeUser, ip);
  }

  // TODO: temporary CC solution
  @Put('name')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiExcludeEndpoint()
  async updateUserName(@GetJwt() jwt: JwtPayload, @Body() data: UserNameDto): Promise<void> {
    await this.userService.updateUserName(jwt.user, data);
  }

  @Post('data')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiCreatedResponse({ type: UserDetailDto })
  @ApiAcceptedResponse(AccountExistsResponse)
  async updateKycData(
    @GetJwt() jwt: JwtPayload,
    @Body() data: KycInputDataDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserDetailDto> {
    const { user, isKnownUser } = await this.userService.updateUserData(jwt.user, data);
    if (isKnownUser) res.status(HttpStatus.ACCEPTED);

    return user;
  }

  @Delete()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse()
  @ApiOperation({ deprecated: true })
  async deleteUser(@GetJwt() jwt: JwtPayload): Promise<void> {
    return this.userService.deactivateUser(jwt.account, jwt.address ?? '');
  }

  @Delete('account')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse()
  @ApiOperation({ deprecated: true })
  async deleteUserAccount(@GetJwt() jwt: JwtPayload): Promise<void> {
    return this.userService.deactivateUser(jwt.account);
  }

  // --- API KEYS --- //
  @Post('apiKey/CT')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT))
  @ApiCreatedResponse({ type: ApiKeyDto })
  async createApiKey(@GetJwt() jwt: JwtPayload, @Query() filter: HistoryFilter): Promise<ApiKeyDto> {
    return this.userDataService.createApiKey(jwt.account, filter);
  }

  @Delete('apiKey/CT')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT))
  @ApiOkResponse()
  async deleteApiKey(@GetJwt() jwt: JwtPayload): Promise<void> {
    if (jwt.user) await this.userService.deleteApiKey(jwt.user);
    return this.userDataService.deleteApiKey(jwt.account);
  }

  @Put('apiFilter/CT')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT))
  @ApiOkResponse({ type: String, isArray: true })
  async updateApiFilter(@GetJwt() jwt: JwtPayload, @Query() filter: HistoryFilter): Promise<HistoryFilterKey[]> {
    if (jwt.user) await this.userService.updateApiFilter(jwt.user, filter);
    return this.userDataService.updateApiFilter(jwt.account, filter);
  }

  // --- ADMIN --- //
  @Get('ref')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getRefInfo(
    @Query() query: RefInfoQuery,
  ): Promise<{ activeUser: number; passiveUser: number; fiatVolume?: number; cryptoVolume?: number }> {
    return this.userService.getRefInfo(query);
  }

  @Get('volumes')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getVolumes(@Query() query: VolumeQuery): Promise<{ buy: number; sell: number }> {
    return this.userService.getUserVolumes(query);
  }

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateUserAdmin(@Param('id') id: string, @Body() dto: UpdateUserAdminDto): Promise<User> {
    return this.userService.updateUserInternal(+id, dto);
  }
}

@ApiTags('User')
@Controller({ path: 'user', version: ['2'] })
export class UserV2Controller {
  constructor(private readonly userService: UserService) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT))
  @ApiOkResponse({ type: UserV2Dto })
  async getUser(@GetJwt() jwt: JwtPayload): Promise<UserV2Dto> {
    return this.userService.getUserDtoV2(jwt.account, jwt.user);
  }

  @Put()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT))
  @ApiOkResponse({ type: UserV2Dto })
  @ApiAcceptedResponse(AccountExistsResponse)
  async updateUser(
    @GetJwt() jwt: JwtPayload,
    @Body() newUser: UpdateUserDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserV2Dto> {
    const { user, isKnownUser } = await this.userService.updateUser(jwt.account, newUser, jwt.user);
    if (isKnownUser) res.status(HttpStatus.ACCEPTED);

    return user;
  }

  @Put('addresses/:address')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT))
  @ApiOkResponse({ type: UserV2Dto })
  async updateAddress(
    @GetJwt() jwt: JwtPayload,
    @Body() newAddress: UpdateAddressDto,
    @Param('address') address: string,
  ): Promise<UserV2Dto> {
    return this.userService.updateAddress(jwt.account, address, newAddress);
  }

  @Delete('addresses/:address')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT))
  @ApiOkResponse()
  async deleteAddress(@GetJwt() jwt: JwtPayload, @Param('address') address: string): Promise<void> {
    return this.userService.deactivateUser(jwt.account, address);
  }

  @Delete()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT))
  @ApiOkResponse()
  async deleteAccount(@GetJwt() jwt: JwtPayload): Promise<void> {
    return this.userService.deactivateUser(jwt.account);
  }

  @Get('ref')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: ReferralDto })
  async getRef(@GetJwt() jwt: JwtPayload): Promise<ReferralDto> {
    return this.userService.getRefDtoV2(jwt.user);
  }
}
