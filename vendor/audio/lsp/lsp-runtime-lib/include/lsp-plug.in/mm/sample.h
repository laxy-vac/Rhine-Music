/*
 * Copyright (C) 2023 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2023 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 16 апр. 2020 г.
 *
 * lsp-runtime-lib is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 *
 * lsp-runtime-lib is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with lsp-runtime-lib. If not, see <https://www.gnu.org/licenses/>.
 */

#ifndef LSP_PLUG_IN_MM_SAMPLE_H_
#define LSP_PLUG_IN_MM_SAMPLE_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/mm/types.h>

namespace lsp
{
    namespace mm
    {
        /**
         * Convert endianess of samples to match CPU endianess
         * @param buf buffer to process
         * @param samples number of samples to process
         * @param format sample format
         * @return true if conversion is possible
         */
        bool sample_endian_to_cpu(void *buf, size_t samples, size_t format);

        /**
         * Convert sample format
         * @param dst destination buffer to store samples
         * @param src source buffer to convert samples (contents may be modified during processing)
         * @param samples number of samples to convert
         * @param to target sample format
         * @param from source sample format
         * @return true if conversion is possible
         */
        bool convert_samples(void *dst, void *src, size_t samples, size_t to, size_t from);
    } /* namespace mm */
} /* namespace lsp */


#endif /* LSP_PLUG_IN_MM_SAMPLE_H_ */
