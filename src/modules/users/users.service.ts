import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { MediaService, MediaFolder, MediaType } from '../media/media.service';
import { Profile } from '@prisma/client';

export interface CreateProfileDto {
  email: string;
  role?: 'USER' | 'PRO' | 'ADMIN';
  country?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  birthDate?: Date;
  companyName?: string;
  siret?: string;
  authProvider?: string;
  isOnboarded?: boolean;
}

@Injectable()
export class UsersService {
  constructor(
    private prismaService: PrismaService,
    private mediaService: MediaService,
  ) {}

  async createProfile(createProfileDto: CreateProfileDto): Promise<Profile> {
    // Check if email already exists
    const existingProfile = await this.prismaService.profile.findUnique({
      where: { email: createProfileDto.email },
    });

    if (existingProfile) {
      throw new BadRequestException('Email already in use');
    }

    return this.prismaService.profile.create({
      data: {
        email: createProfileDto.email,
        role: createProfileDto.role || null,
        country: createProfileDto.country,
        firstName: createProfileDto.firstName,
        lastName: createProfileDto.lastName,
        phone: createProfileDto.phone,
        birthDate: createProfileDto.birthDate,
        companyName: createProfileDto.companyName,
        siret: createProfileDto.siret,
        authProvider: createProfileDto.authProvider,
        isOnboarded: createProfileDto.isOnboarded ?? true,
      },
    });
  }

  async getProfileById(id: string): Promise<Profile | null> {
    return this.prismaService.profile.findUnique({
      where: { id },
    });
  }

  async getProfileByEmail(email: string): Promise<Profile | null> {
    return this.prismaService.profile.findUnique({
      where: { email },
    });
  }

  async getMe(userId: string): Promise<Omit<Profile, 'passwordHash'>> {
    const profile = await this.prismaService.profile.findUnique({
      where: { id: userId },
    });

    if (!profile) {
      throw new NotFoundException('Profil introuvable');
    }

    const { passwordHash, ...result } = profile;
    return result;
  }

  async getPublicProfile(id: string): Promise<Partial<Profile>> {
    const profile = await this.prismaService.profile.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        avatar: true,
        role: true,
        country: true,
        createdAt: true,
      },
    });

    if (!profile) {
      throw new NotFoundException('Profil introuvable');
    }

    return profile;
  }

  async updateMe(
    userId: string,
    data: {
      firstName?: string;
      lastName?: string;
      phone?: string;
      avatar?: string;
      deviceToken?: string;
      dateOfBirth?: string;
    },
  ): Promise<Omit<Profile, 'passwordHash'>> {
    const { dateOfBirth, ...rest } = data;
    const profile = await this.prismaService.profile.update({
      where: { id: userId },
      data: {
        ...rest,
        ...(dateOfBirth && { birthDate: new Date(dateOfBirth) }),
      },
    });

    const { passwordHash, ...result } = profile;
    return result;
  }

  async updateAvatar(
    userId: string,
    file: Express.Multer.File,
  ): Promise<Omit<Profile, 'passwordHash'>> {
    // Supprimer l'ancien avatar si existant
    const currentProfile = await this.prismaService.profile.findUnique({
      where: { id: userId },
    });

    if (currentProfile?.avatar) {
      const oldKey = this.mediaService.extractKeyFromUrl(currentProfile.avatar);
      if (oldKey) {
        await this.mediaService.delete(oldKey).catch(() => {});
      }
    }

    const uploadResult = await this.mediaService.upload(
      file,
      MediaFolder.PROFILES,
      MediaType.IMAGE,
      { subfolder: userId, makePublic: true },
    );

    const profile = await this.prismaService.profile.update({
      where: { id: userId },
      data: { avatar: uploadResult.url },
    });

    const { passwordHash, ...result } = profile;
    return result;
  }

  async checkCountriesAvailability(countries: string[]): Promise<string[]> {
    const priorityCountriesEnv = process.env.PRIORITY_COUNTRIES || 'FR';
    const priorityCountries = priorityCountriesEnv.split(',').map((c) => c.trim());
    const minTestersPerCountry = parseInt(
      process.env.MIN_TESTERS_PER_COUNTRY || '10',
      10,
    );

    const testerCounts = await this.prismaService.profile.groupBy({
      by: ['country'],
      where: {
        role: 'USER',
        country: { in: countries },
      },
      _count: { country: true },
    });

    const testerCountMap = new Map<string, number>();
    testerCounts.forEach((item) => {
      if (item.country) {
        testerCountMap.set(item.country, item._count.country);
      }
    });

    return countries.filter((code) => {
      const isPriority = priorityCountries.includes(code);
      const testerCount = testerCountMap.get(code) || 0;
      return isPriority || testerCount >= minTestersPerCountry;
    });
  }

  async getAvailableCountries(): Promise<any[]> {
    const priorityCountriesEnv = process.env.PRIORITY_COUNTRIES || 'FR';
    const priorityCountries = priorityCountriesEnv.split(',').map((c) => c.trim());
    const minTestersPerCountry = parseInt(
      process.env.MIN_TESTERS_PER_COUNTRY || '10',
      10,
    );

    const countries = await this.prismaService.country.findMany({
      orderBy: [{ name: 'asc' }],
    });

    const testerCounts = await this.prismaService.profile.groupBy({
      by: ['country'],
      where: {
        role: 'USER',
        country: { not: null },
      },
      _count: {
        country: true,
      },
    });

    const testerCountMap = new Map<string, number>();
    testerCounts.forEach((item) => {
      if (item.country) {
        testerCountMap.set(item.country, item._count.country);
      }
    });

    const countriesWithAvailability = countries.map((c) => {
      const isPriority = priorityCountries.includes(c.code);
      const testerCount = testerCountMap.get(c.code) || 0;
      const isActive = isPriority || testerCount >= minTestersPerCountry;

      return {
        code: c.code,
        name: c.nameFr,
        nameEn: c.nameEn,
        nameFr: c.nameFr,
        isActive,
        region: c.region,
      };
    });

    return countriesWithAvailability.sort((a, b) => {
      if (a.isActive !== b.isActive) {
        return a.isActive ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }
}
