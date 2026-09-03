import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  handleRequest(err: any, user: any) {
    // Don't throw when login fails — just pass along whatever we got
    // (a user object on success, or `false` on rejection) to the controller
    return user;
  }
}