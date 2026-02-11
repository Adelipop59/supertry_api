import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Profile } from '@prisma/client';

export interface CreateProfileDto {
  email: string;
  role?: 'USER' | 'PRO' | 'ADMIN';
  country?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  companyName?: string;
  siret?: string;
  authProvider?: string;
  isOnboarded?: boolean;
}

@Injectable()
export class UsersService {
  constructor(private prismaService: PrismaService) {}

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
