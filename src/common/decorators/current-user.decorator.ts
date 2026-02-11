import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;

    // Si une propriété spécifique est demandée (ex: 'id'), la retourner
    if (data && user) {
      return user[data];
    }

    // Sinon retourner tout l'objet user
    return user;
  },
);
