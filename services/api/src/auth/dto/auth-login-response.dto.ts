import { AuthUserResponseDto } from './auth-user-response.dto';

export interface AuthLoginResponseDto {
  accessToken: string;
  user: AuthUserResponseDto;
}
